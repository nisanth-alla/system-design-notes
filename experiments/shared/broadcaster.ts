/**
 * Wraps a WebSocket server around an existing Express http.Server so a
 * server can broadcast the real events it's already producing (cache
 * misses, db calls, charges, etc.) to any connected visualization.
 *
 * This is purely additive — it doesn't change any HTTP response or the
 * server's existing console.log behavior. It exists so the visualizations
 * app's "Live" mode can show real events from a real running server,
 * alongside its own "Simulated" mode which fakes the same event shapes.
 */

import { Server as HttpServer } from "http";
import { WebSocketServer } from "ws";

export function createBroadcaster(httpServer: HttpServer) {
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "connected" }));
  });

  function broadcast(event: object): void {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }

  return { broadcast };
}
