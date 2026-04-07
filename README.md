# translate-api

HTTP server dịch văn bản tiếng Anh → tiếng Việt, sử dụng **Claude CLI** (subscription claude.ai — không cần API key trả tiền riêng).

Được thiết kế để Chrome Extension gọi vào thay thế Google Translate, cho chất lượng dịch tự nhiên hơn.

---

## Cách hoạt động

```
Client (Chrome Extension / curl / bất kỳ app nào)
        │
        │  POST /translate
        │  { "text": "Hello world" }
        │  Authorization: Bearer <SECRET>
        ▼
  translate-api (Node.js HTTP server)
        │
        │  spawn("claude --print --dangerously-skip-permissions")
        │  stdin ← prompt + text cần dịch
        ▼
  Claude CLI (đã claude login bằng tài khoản subscription)
        │
        │  stdout → bản dịch tiếng Việt
        ▼
  { "translated": "Xin chào thế giới" }
```

**Tại sao không dùng API key?**
Claude CLI sau khi `claude login` sẽ dùng phiên đăng nhập của tài khoản subscription ($20/$100/tháng). App này gọi `claude` như một subprocess, truyền prompt qua stdin và đọc kết quả từ stdout — hoàn toàn không cần API key riêng.

---

## Yêu cầu

- Node.js 18+
- `claude` CLI đã cài và đã `claude login` (với tài khoản có subscription)
- Nếu chạy với quyền root (Docker/VPS): cần user `botuser` đã login Claude

```bash
# Kiểm tra claude CLI có hoạt động không
claude --print "Say hello" --dangerously-skip-permissions
```

---

## Cài đặt

```bash
# 1. Cài dependencies
npm install

# 2. Tạo file .env
cp .env.example .env

# 3. Sửa .env — quan trọng: đặt SECRET ngẫu nhiên
nano .env
```

Nội dung `.env`:
```env
PORT=3099
SECRET=abc123xyz-random-string-here
CLAUDE_MODEL=claude-sonnet-4-6
```

---

## Chạy

```bash
# Development (auto-reload khi sửa code)
npm run dev

# Production
npm run build
npm start
```

Khi khởi động thành công:
```
✅ translate-api đang chạy tại http://localhost:3099
   Model  : claude-sonnet-4-6
   Secret : ✓ configured
```

---

## API

### `POST /translate`

Dịch văn bản sang tiếng Việt.

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <SECRET>
```

**Body:**
```json
{ "text": "Text cần dịch" }
```

**Response 200:**
```json
{ "translated": "Bản dịch tiếng Việt" }
```

**Response 401** — sai hoặc thiếu secret:
```json
{ "error": "Unauthorized" }
```

**Response 500** — Claude CLI lỗi (chưa login, timeout, v.v.):
```json
{ "error": "Cannot run claude CLI: ..." }
```

---

### `GET /health`

Kiểm tra server còn sống.

```bash
curl http://localhost:3099/health
# → {"status":"ok"}
```

---

## Ví dụ gọi API

```bash
curl -X POST http://localhost:3099/translate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SECRET" \
  -d '{"text":"The Federal Reserve raised interest rates by 25 basis points."}'
```

```json
{
  "translated": "Cục Dự trữ Liên bang đã tăng lãi suất thêm 25 điểm cơ bản."
}
```

---

## Deploy lên VPS

### Với PM2

```bash
# Cài PM2
npm install -g pm2

# Build
npm run build

# Chạy
pm2 start dist/index.js --name translate-api

# Tự khởi động khi reboot
pm2 save
pm2 startup
```

### Với Docker (nếu app đang chạy root)

Khi chạy với quyền root, server tự động dùng `runuser -u botuser` để gọi Claude CLI.
Yêu cầu: user `botuser` đã tồn tại và đã chạy `claude login`.

```bash
# Tạo botuser (1 lần)
useradd -m botuser

# Login Claude với botuser
su - botuser -c "claude login"
```

### Mở port firewall

```bash
# Ubuntu/Debian
ufw allow 3099

# Hoặc dùng nginx reverse proxy để chạy qua port 80/443
```

---

## Tích hợp Chrome Extension

File `background.js` của extension cần sửa 2 dòng:

```js
const VPS_ENDPOINT = "http://YOUR_VPS_IP:3099/translate";
const VPS_SECRET   = "YOUR_SECRET";  // phải khớp với SECRET trong .env
```

Extension có fallback tự động về Google Translate nếu VPS không phản hồi.

---

## Cấu trúc code

```
src/
└── index.ts       ← Toàn bộ logic trong 1 file duy nhất
    ├── Config      (PORT, SECRET, MODEL từ .env)
    ├── stripAnsi() (xóa màu ANSI khỏi output Claude CLI)
    ├── callClaude() (spawn Claude subprocess, truyền prompt)
    └── HTTP server (routing, auth, parse body, gọi callClaude)
```

File nhỏ gọn, không có abstraction phức tạp — đọc thẳng từ trên xuống là hiểu hết.

---

## Troubleshooting

**`Cannot run claude CLI`**
→ Claude CLI chưa cài hoặc không có trong PATH. Chạy `which claude` để kiểm tra.

**`Claude exited with code 1`**
→ Chưa `claude login`. Chạy `claude login` rồi thử lại.

**Response chậm (10-30s)**
→ Bình thường — Claude CLI cần khởi động session mỗi lần gọi. Nếu cần nhanh hơn, cân nhắc dùng Anthropic API key chính thức.

**`Unauthorized`**
→ Header `Authorization: Bearer ...` sai hoặc thiếu, hoặc SECRET trong `.env` không khớp.
