//! Core library of AgentDeck.
//!
//! Everything that touches agent configuration files lives here, so the
//! desktop app and the CLI share exactly the same behavior.

pub mod agent;
pub mod config_file;
pub mod error;
pub mod health;
pub mod mcp;
pub mod pricing;
pub mod probe;
pub mod rules;
pub mod secrets;
pub mod skills;
pub mod usage;

pub use agent::{Agent, AgentInfo};
pub use error::{Error, ErrorInfo, Result};
pub use mcp::{McpServer, ServerSpec, Transport};
