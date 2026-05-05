# 🃏 Tarot Africain — Multijoueur en ligne (Docker)

## Lancement rapide

```bash
unzip tarot-africain.zip
cd tarot-africain
docker compose up -d
# → http://localhost:3000
```

C'est tout. Docker gère Node.js, les dépendances et le redémarrage automatique.

---

## Commandes utiles

```bash
docker compose logs -f          # logs en direct
docker compose down             # arrêter
docker compose up -d --build    # rebuild après modif code
PORT=8080 docker compose up -d  # changer le port
```

---

## Nginx + HTTPS (optionnel)

```nginx
server {
    listen 80;
    server_name votre-domaine.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

```bash
sudo certbot --nginx -d votre-domaine.com
```

> ⚠️ Les headers `Upgrade` sont obligatoires pour Socket.io (WebSocket).

---

## Structure

```
tarot-africain/
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── server.js
├── package.json
└── public/
    └── index.html
```
