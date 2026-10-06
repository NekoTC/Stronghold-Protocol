# COS 上传和配置指南

## 第一步：上传资源到 COS

### Windows 本地上传（推荐）

1. 创建配置文件 `.env.cos`：
```powershell
$env:SP_OBJECT_STORAGE_BUCKET="nekotc-1301711413"
$env:TENCENTCLOUD_SECRET_ID="你的SecretId"
$env:TENCENTCLOUD_SECRET_KEY="你的SecretKey"
$env:SP_COS_REGION="ap-chongqing"
$env:SP_OBJECT_STORAGE_PREFIX="v0.1.3"
```

2. 运行上传：
```powershell
node tools/upload-to-cos.mjs
```

### Linux 服务器上传

1. 创建配置文件：
```bash
cat > .env.cos << 'EOF'
export SP_OBJECT_STORAGE_BUCKET="nekotc-1301711413"
export TENCENTCLOUD_SECRET_ID="你的SecretId"
export TENCENTCLOUD_SECRET_KEY="你的SecretKey"
export SP_COS_REGION="ap-chongqing"
export SP_OBJECT_STORAGE_PREFIX="v0.1.3"
EOF
```

2. 加载并上传：
```bash
source .env.cos
node tools/upload-to-cos.mjs
```

## 第二步：配置服务器使用 COS

在 Linux 服务器上设置环境变量（启动服务器前）：

```bash
export SP_ASSET_BASE_URL="https://nekotc-1301711413.cos.ap-chongqing.myqcloud.com/v0.1.3"
export SP_DATA_BASE_URL="https://nekotc-1301711413.cos.ap-chongqing.myqcloud.com/v0.1.3/data"
npm start
```

或者使用 PM2 持久化配置：
```bash
pm2 start server/index.js --name stronghold --env production \
  -e SP_ASSET_BASE_URL=https://nekotc-1301711413.cos.ap-chongqing.myqcloud.com/v0.1.3 \
  -e SP_DATA_BASE_URL=https://nekotc-1301711413.cos.ap-chongqing.myqcloud.com/v0.1.3/data
pm2 save
```

## 验证

访问 http://192.168.124.244:3000/runtime-config.json 应该看到：
```json
{
  "version": 1,
  "assetBase": "https://nekotc-1301711413.cos.ap-chongqing.myqcloud.com/v0.1.3",
  "dataBase": "https://nekotc-1301711413.cos.ap-chongqing.myqcloud.com/v0.1.3/data"
}
```
