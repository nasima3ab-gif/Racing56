# Racing56

Browser-based 1v1 multiplayer 3D racing game with an authoritative Ammo.js server.

## Run locally

```bash
cd Racing56
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install --no-audit --no-fund
node server.js
```

Open `http://localhost:3000` in two tabs or two machines.

## Deploy

This project has two parts:

- Frontend (static): `Racing56/public` for Netlify
- Backend (Node): `Racing56/server.js` for Render/Fly/Railway/etc.

Netlify settings:

```toml
[build]
  publish = "public"
  command = ""

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

After deploying the backend, enter the server URL on the game menu (or append `?backend=https://your-backend`).

## Assets and licenses

Assets are CC0 and stored in `Racing56/public/assets`:

- Kenney Car Kit (car model)
- Quaternius LowPoly Modular Street Pack (road tiles)
- Poly Haven HDRI (environment map)
