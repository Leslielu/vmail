# vmail

Cloudflare Worker 临时邮箱服务，用于接收和查询临时邮件。

## 功能

- 生成随机临时邮箱地址
- 通过 Cloudflare Email Routing 接收邮件
- REST API 查询邮件
- 邮件自动过期（默认1小时）
- 支持 API 密钥保护

## 部署

### 1. 创建 KV 命名空间

```bash
wrangler kv:namespace create EMAILS
wrangler kv:namespace create EMAILS --preview
```

将返回的 ID 更新到 `wrangler.toml`:

```toml
kv_namespaces = [
  { binding = "EMAILS", id = "YOUR_KV_NAMESPACE_ID" }
]
```

### 2. 配置域名和 Email Routing

1. 在 Cloudflare Dashboard 中添加你的域名
2. 进入 **Email** > **Email Routing**
3. 启用 Email Routing
4. 添加 Catch-all 规则，将所有邮件发送到 Worker

### 3. 部署 Worker

```bash
npm install
npm run deploy
```

### 4. 配置环境变量（可选）

```bash
# 设置 API 密钥
wrangler secret put API_KEY
```

## API 接口

### 健康检查

```bash
GET /
GET /health
```

### 生成临时邮箱

```bash
POST /api/generate
Content-Type: application/json

{
  "domain": "your-domain.com"
}
```

响应:
```json
{
  "email": "abc123xyz@your-domain.com",
  "expires_in": 3600,
  "expires_at": "2026-03-07T12:00:00.000Z"
}
```

### 查询收件箱

```bash
GET /api/inbox?email=abc123xyz@your-domain.com
```

响应:
```json
{
  "email": "abc123xyz@your-domain.com",
  "messages": [
    {
      "id": "1234567890-abcd1234",
      "from": "sender@example.com",
      "subject": "Test Email",
      "date": "2026-03-07T11:00:00.000Z"
    }
  ],
  "count": 1
}
```

### 获取邮件详情

```bash
GET /api/email/{email_id}
```

### 删除邮件

```bash
DELETE /api/email/{email_id}
```

### 列出所有邮件（管理）

```bash
GET /api/emails?limit=50
```

## 配置说明

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `API_KEY` | API 访问密钥（可选） | 无 |
| `EMAIL_TTL` | 邮件保留时间（秒） | 3600 |

## 本地开发

```bash
npm install
npm run dev
```

## 与 codex_register.py 集成

可以在 `codex_register.py` 中添加新的 EmailProvider 使用此服务：

```python
class VMaillProvider(EmailProvider):
    def __init__(self, base_url, domain, api_key=None):
        self.base_url = base_url
        self.domain = domain
        self.api_key = api_key

    def create_email(self):
        headers = {}
        if self.api_key:
            headers['Authorization'] = f'Bearer {self.api_key}'

        resp = requests.post(
            f'{self.base_url}/api/generate',
            json={'domain': self.domain},
            headers=headers
        )
        data = resp.json()
        return data['email']

    def get_emails(self, email):
        headers = {}
        if self.api_key:
            headers['Authorization'] = f'Bearer {self.api_key}'

        resp = requests.get(
            f'{self.base_url}/api/inbox',
            params={'email': email},
            headers=headers
        )
        return resp.json().get('messages', [])
```

## License

MIT
