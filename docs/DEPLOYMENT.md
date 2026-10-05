# COS Upload & Server Deployment Guide

## 1. 上传资源到 COS

### 配置环境变量
```bash
# 复制配置模板
cp cos-config.sh.example .env.cos

# 编辑配置文件
nano .env.cos

# 加载环境变量
source .env.cos
```

### 上传文件
```bash
# 测试上传（不实际上传）
node tools/upload-to-cos.mjs --dry-run

# 正式上传全部文件
node tools/upload-to-cos.mjs

# 只上传资源文件（跳过数据文件）
node tools/upload-to-cos.mjs --skip-data

# 只上传数据文件
node tools/upload-to-cos.mjs --data-only
```

## 2. 启动服务器

### 环境变量配置
```bash
# 运行时配置（使用 COS CDN）
export SP_ASSET_BASE_URL="https://your-cdn.com/assets"
export SP_DATA_BASE_URL="https://your-cdn.com/data"
export HOST="0.0.0.0"
export PORT="3000"

# 启动服务器
npm start
```

### 防火墙配置（Linux）
```bash
# 检查端口是否被占用
sudo netstat -tlnp | grep :3000

# 检查防火墙状态
sudo ufw status

# 允许端口 3000（如果使用 ufw）
sudo ufw allow 3000/tcp

# 或者使用 firewall-cmd（CentOS/RHEL）
sudo firewall-cmd --zone=public --add-port=3000/tcp --permanent
sudo firewall-cmd --reload

# 或者使用 iptables
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
sudo iptables-save
```

### 检查服务是否运行
```bash
# 本地测试
curl http://localhost:3000

# 检查监听地址
sudo netstat -tlnp | grep :3000
# 应该显示: 0.0.0.0:3000

# 从外部测试（在另一台机器上）
curl http://192.168.124.244:3000
```

### 使用 PM2 保持服务运行
```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start npm --name "stronghold" -- start

# 查看日志
pm2 logs stronghold

# 重启服务
pm2 restart stronghold

# 设置开机自启
pm2 startup
pm2 save
```

## 3. 验证部署

### 检查运行时配置
```bash
curl http://192.168.124.244:3000/runtime-config.json
```

应该返回类似：
```json
{
  "version": 1,
  "assetBase": "https://your-cdn.com/assets",
  "dataBase": "https://your-cdn.com/data"
}
```

### 测试离线模式
1. 在浏览器中访问 http://192.168.124.244:3000
2. 等待资源加载完成（检查浏览器控制台）
3. 停止服务器：`pm2 stop stronghold`
4. 刷新浏览器 - 应该仍然可以加载
5. 创建单人模式比赛 - 应该正常工作

## 4. 常见问题

### 无法从外部访问
```bash
# 检查服务是否监听在 0.0.0.0
netstat -tlnp | grep :3000

# 检查防火墙
sudo ufw status
sudo firewall-cmd --list-all

# 检查云服务器安全组（如果使用阿里云/腾讯云）
# 需要在控制台开放 3000 端口
```

### COS 上传失败
```bash
# 检查环境变量
echo $SP_OBJECT_STORAGE_BUCKET
echo $TENCENTCLOUD_SECRET_ID

# 重新加载配置
source .env.cos

# 查看详细错误
node tools/upload-to-cos.mjs 2>&1 | tee upload.log
```

### Service Worker 不工作
- 检查浏览器控制台是否有错误
- Service Worker 需要 HTTPS 或 localhost
- 清除浏览器缓存后重试
