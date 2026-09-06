# y64-status

A public server status API for y64

## Public instance

`https://status.y64.org/status/<host>`

Free to use with no API key. Requests are rate limited per IP

## Setup

1. Run `npm install`
2. Create a `.env` file from `.env.example`
3. Configure the following values:
   - `MC_HOST` - default server to check (default `localhost`)
   - `MC_PORT` - default port (default `25565`)
   - `PORT` - port the API listens on (default `3001`)
   - `RATE_LIMIT_MAX` - max requests per IP per window (default `30`)
   - `RATE_LIMIT_WINDOW_MS` - rate limit window in ms (default `60000`)
   - `CACHE_TTL_MS` - how long a server's status is cached (default `10000`)
   - `CONNECT_TIMEOUT_MS` - how long to wait for a Minecraft server to respond (default `3000`)
4. Run `npm start`

## Usage

`GET /status` returns the status of the server configured in `.env`

`GET /status/<host>` and `GET /status/<host>/<port>` return the status of any Minecraft server:

```json
{
  "online": true,
  "players": { "online": 1, "max": 100 },
  "version": { "raw": "Paper 26.2", "software": "Paper", "protocol": "26.2" },
  "motd": "Anarchy for Everyone"
}
```

If the server is offline or unreachable, `players`, `version` and `motd` are `null`:

```json
{ "online": false, "players": null, "version": null, "motd": null }
```

Invalid hosts or ports return `400`. Unknown routes return `404`

Requests are rate limited per IP by `RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_MS`. Exceeding the limit returns `429` with a `Retry-After` header

Each server is cached for `CACHE_TTL_MS`. Every response includes CORS headers so the API can be called directly from a browser

`_minecraft._tcp.<host>` SRV records are resolved automatically before connecting, just like a real Minecraft client. This allows `<host>` to work even when it only points to the server through an SRV record
