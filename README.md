# Talat Pinklao — Market Stall Booking System

Online stall booking and market zoning for the hospital market at Somdech Phra Pinklao Hospital.
A plain Node.js + Express + PostgreSQL backend, with a static HTML/CSS/JS frontend — no framework,
no build step. Everyone who opens the link sees the exact same, always-current page.

## What's in here

```
server/            Express API
  index.js         serves the API, uploaded images (/files/...) and the frontend
  db.js            Postgres connection, schema + seed data
  files.js         image uploads (receipts, PromptPay QR) stored inside the database
  routes/          one file per resource (auth, zones, stalls, bookings, ...)
public/            the frontend (index.html, styles.css, isomap.js, app.js)
render.yaml        one-click config for Render
```

## Where the data lives

All data — bookings, accounts, the market map, and uploaded images — is stored in a
**PostgreSQL database on [Neon](https://neon.tech) (free tier)**, so nothing is lost when Render
redeploys or restarts the server. The server reads the connection string from the
`DATABASE_URL` environment variable and refuses to start on Render without it.

Images are shrunk in the browser before upload (max 1600px), so a slip photo is typically
200–300 KB. Neon's free 0.5 GB holds roughly a couple of thousand slips.

## Local setup (needs Node.js 20)

```bash
cd server
npm install
npm start
```

Without `DATABASE_URL`, the server uses a local embedded Postgres (PGlite) stored in
`server/.pgdata/` — handy for development. Open http://localhost:4000.

Head admin login is seeded automatically: **username `ongsa`, password `GGEZ`** — change it once
you're live (create a new head admin account and deactivate the old one).

## สรุปขั้นตอนคร่าวๆ (ไม่ต้องติดตั้ง git)

1. สร้าง repo บน GitHub แล้วอัปโหลดไฟล์ผ่านหน้าเว็บ (Add file → Upload files)
2. สมัคร Neon (ฟรี) สร้างโปรเจกต์ แล้วคัดลอก connection string
3. ที่ Render เชื่อมกับ GitHub repo แล้วใส่ connection string เป็น `DATABASE_URL` ในหน้า Environment
4. ได้ลิงก์ถาวร เช่น `https://talat-pinklao.onrender.com` และข้อมูลไม่หายเมื่อ deploy ใหม่

## Step 1 — Create the database on Neon

1. Sign up at [neon.tech](https://neon.tech) (free, no credit card).
2. Create a project (any name; pick the region closest to your Render service, e.g. Singapore
   or US West to match Render's Oregon region).
3. On the project dashboard click **Connect**, keep **Connection pooling** on, and copy the
   connection string. It looks like
   `postgresql://user:password@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require`.
   Treat it like a password — never commit it to GitHub.

## Step 2 — Deploy on Render

1. On [render.com](https://render.com), **New +** → **Blueprint**, connect the GitHub repo.
   Render reads `render.yaml` (Node service, build/start commands, a generated `JWT_SECRET`).
2. Open the service → **Environment** → add `DATABASE_URL` = the Neon connection string → **Save**.
3. Deploy. The server creates all tables and seed data on first start.
4. If a push doesn't trigger a deploy (Render's auto-deploy occasionally stalls after several
   quick commits), use **Manual Deploy → Deploy latest commit**.

Free Render services sleep after ~15 minutes idle; the first visit afterwards takes ~30–60 s.
Data is safe either way — it lives in Neon.

## Accounts

- **Head admin** (seeded automatically): username `ongsa`, password `GGEZ`. Can manage staff
  accounts (ระบบแอดมิน → แอดมิน) and upload the PromptPay QR code (ระบบแอดมิน → ตั้งค่า).
- **Staff accounts**: created by the head admin. Deactivating one takes effect immediately.
- **Vendors**: book as a guest (bookings tied to that browser) or register an account from the
  "เข้าสู่ระบบ" button so their bookings follow them across devices.
