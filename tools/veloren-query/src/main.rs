// SPDX-License-Identifier: GPL-3.0-or-later
use std::{net::SocketAddr, process::ExitCode};
use veloren_query_server::client::QueryClient;

#[tokio::main]
async fn main() -> ExitCode {
    let Some(address) = std::env::args()
        .nth(1)
        .and_then(|value| value.parse::<SocketAddr>().ok())
    else {
        eprintln!("Usage: voltra-veloren-query IP:PORT");
        return ExitCode::FAILURE;
    };
    match QueryClient::new(address).server_info().await {
        Ok((info, latency)) => {
            println!("{{\"git_hash\":\"{:08x}\",\"git_timestamp\":{},\"players\":{},\"player_cap\":{},\"battle_mode\":\"{:?}\",\"latency_ms\":{}}}", info.git_hash, info.git_timestamp, info.players_count, info.player_cap, info.battlemode, latency.as_millis());
            ExitCode::SUCCESS
        }
        Err(_) => {
            eprintln!("Native Veloren server query failed.");
            ExitCode::FAILURE
        }
    }
}
