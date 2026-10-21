//! API list prices used to estimate what a session would cost.
//!
//! Subscriptions (Claude Max, ChatGPT plans) are billed differently, so these
//! numbers are estimates at pay-as-you-go API rates, in USD per million tokens.

use crate::usage::Tokens;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Price {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
}

/// Model id prefixes, most specific first.
const PRICES: &[(&str, Price)] = &[
    // Anthropic
    ("claude-fable-5-1", price(10.0, 50.0, 0.25)),
    ("claude-fable-5", price(10.0, 50.0, 1.0)),
    ("claude-mythos-5-1", price(10.0, 50.0, 0.25)),
    ("claude-mythos-5", price(10.0, 50.0, 1.0)),
    ("claude-opus-5-5", price(4.0, 20.0, 0.2)),
    ("claude-opus-5", price(5.0, 25.0, 0.5)),
    ("claude-opus-4-8", price(5.0, 25.0, 0.5)),
    ("claude-opus-4-7", price(5.0, 25.0, 0.5)),
    ("claude-opus-4-6", price(5.0, 25.0, 0.5)),
    ("claude-opus-4-5", price(5.0, 25.0, 0.5)),
    ("claude-opus-4-1", price(15.0, 75.0, 1.5)),
    ("claude-opus-4", price(15.0, 75.0, 1.5)),
    ("claude-sonnet-5-5", price(2.0, 10.0, 0.2)),
    ("claude-sonnet-5", price(2.0, 10.0, 0.2)),
    ("claude-sonnet-4-6", price(3.0, 15.0, 0.3)),
    ("claude-sonnet-4-5", price(3.0, 15.0, 0.3)),
    ("claude-sonnet-4", price(3.0, 15.0, 0.3)),
    ("claude-3-7-sonnet", price(3.0, 15.0, 0.3)),
    ("claude-haiku-5-5", price(0.1, 0.5, 0.01)),
    ("claude-haiku-4-5", price(1.0, 5.0, 0.1)),
    ("claude-3-5-haiku", price(0.8, 4.0, 0.08)),
    // OpenAI models used by Codex
    ("gpt-5.2", price(1.75, 14.0, 0.175)),
    ("gpt-5.1-codex-mini", price(0.25, 2.0, 0.025)),
    ("gpt-5-codex-mini", price(0.25, 2.0, 0.025)),
    ("gpt-5-mini", price(0.25, 2.0, 0.025)),
    ("gpt-5-nano", price(0.05, 0.4, 0.005)),
    ("gpt-5.1", price(1.25, 10.0, 0.125)),
    ("gpt-5-codex", price(1.25, 10.0, 0.125)),
    ("gpt-5", price(1.25, 10.0, 0.125)),
];

const fn price(input: f64, output: f64, cache_read: f64) -> Price {
    Price {
        input,
        output,
        cache_read,
    }
}

/// Looks up the price of a model, ignoring a context suffix such as `[1m]`,
/// a release date or a variant name. An unknown version gets no price rather
/// than the price of an older one.
pub fn lookup(model: &str) -> Option<Price> {
    let model = model.split('[').next().unwrap_or(model);
    PRICES
        .iter()
        .find(|(prefix, _)| model.strip_prefix(prefix).is_some_and(is_suffix))
        .map(|(_, price)| *price)
}

/// What may follow a known model id: nothing, a variant (`-codex-max`) or a
/// date (`-20250514`), but not another version number (`-5`, `.3`).
fn is_suffix(rest: &str) -> bool {
    let Some(tail) = rest.strip_prefix('-') else {
        return rest.is_empty();
    };
    let digits = tail.chars().take_while(char::is_ascii_digit).count();
    digits == 0 || digits == 8
}

/// Cost in USD. Cache writes cost 1.25x the input price for a 5-minute TTL
/// and 2x for a 1-hour TTL.
pub fn cost(price: Price, tokens: &Tokens) -> f64 {
    let millions = |n: u64| n as f64 / 1_000_000.0;
    millions(tokens.input) * price.input
        + millions(tokens.output) * price.output
        + millions(tokens.cache_read) * price.cache_read
        + millions(tokens.cache_write_5m) * price.input * 1.25
        + millions(tokens.cache_write_1h) * price.input * 2.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_dated_and_variant_ids_but_not_newer_versions() {
        assert_eq!(lookup("claude-opus-5-5").unwrap().input, 4.0);
        assert_eq!(lookup("claude-opus-5-5[1m]").unwrap().input, 4.0);
        assert_eq!(lookup("claude-opus-5").unwrap().input, 5.0);
        assert_eq!(lookup("claude-sonnet-4-20250514").unwrap().input, 3.0);
        assert_eq!(lookup("claude-opus-4-1-20250805").unwrap().input, 15.0);
        assert_eq!(lookup("gpt-5.1-codex-max").unwrap().input, 1.25);
        assert_eq!(lookup("gpt-5-codex-mini").unwrap().input, 0.25);
        assert!(lookup("claude-opus-5-7").is_none());
        assert!(lookup("gpt-5.3-codex").is_none());
        assert!(lookup("<synthetic>").is_none());
    }

    #[test]
    fn cache_writes_cost_more_than_input() {
        let tokens = Tokens {
            input: 1_000_000,
            cache_write_5m: 1_000_000,
            cache_write_1h: 1_000_000,
            ..Tokens::default()
        };
        let price = lookup("claude-opus-5-5").unwrap();
        assert!((cost(price, &tokens) - (4.0 + 5.0 + 8.0)).abs() < 1e-9);
    }
}
