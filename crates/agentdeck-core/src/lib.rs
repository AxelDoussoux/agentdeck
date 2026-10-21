//! Core library of AgentDeck.
//!
//! Everything that touches agent configuration files lives here, so the
//! desktop app and the CLI share exactly the same behavior.

pub mod agent;
pub mod config_file;
pub mod error;
pub mod mcp;

pub use agent::{Agent, AgentInfo};
pub use error::{Error, Result};
pub use mcp::{McpServer, ServerSpec, Transport};
