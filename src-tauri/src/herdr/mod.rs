//! Herdr client core: socket paths, JSON API requests, and per-pane
//! terminal attach actors speaking the binary render protocol.

pub mod api;
pub mod events;
pub mod gitinfo;
pub mod paths;
pub mod remotefs;
pub mod servers;
pub mod term;
#[cfg(test)]
mod probe_test;
#[cfg(test)]
mod gen_test;
