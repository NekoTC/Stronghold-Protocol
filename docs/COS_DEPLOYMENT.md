# 腾讯云 COS 部署指南

## 概述

本项目支持将资源文件上传到腾讯云对象存储（COS），实现 CDN 加速分发。客户端资源完全从 COS 下载，不再占用源站带宽。即使服务器离线，已缓存的用户仍可进入单人模式。

## 架构设计

### 资源加载流程

1. 客户端启动时加载 /runtime-config.json，获取 CDN 配置：
   - assetBase: 静态资源（图片、字体）的 CDN 前缀
   - dataBase: 游戏数据文件（JSON）的 CDN 前缀

2. Service Worker (v3) 实现智能缓存策略：
   - 导航请求: 网络优先，失败时返回缓存的主页
   - 数据文件 (/data/*.json): 缓存优先 + 后台更新
   - 静态资源: 缓存优先
   - 其他请求: 网络优先 + 缓存降级

3. 离线模式：
   - Service Worker 预缓存核心文件（shell + 11 个关键数据文件）
   - 单人模式使用本地 StubMatch 模拟，无需服务器连接
   - Solo 会话断线后 24 小时内仍可恢复

## 环境变量配置

### 必需变量

`ash
# COS 存储桶名称（例如：stronghold-1234567890）
SP_OBJECT_STORAGE_BUCKET=your-bucket-name

# 腾讯云访问凭证
TENCENTCLOUD_SECRET_ID=your-secret-id
TENCENTCLOUD_SECRET_KEY=your-secret-key
`

### 可选变量

`ash
# COS 区域（默认：ap-shanghai）
SP_COS_REGION=ap-shanghai

# 存储桶内路径前缀（例如：prod、staging）
SP_OBJECT_STORAGE_PREFIX=prod

# CDN 加速域名（静态资源：assets、fonts）
SP_ASSET_BASE_URL=https://cdn.example.com/assets

# CDN 加速域名（数据文件：data/*.json）
SP_DATA_BASE_URL=https://cdn.example.com/data
`

## 上传工具使用

### 基本用法

`ash
# 上传所有文件（assets + fonts + data）
node tools/upload-to-cos.mjs

# 仅上传静态资源（跳过数据文件）
node tools/upload-to-cos.mjs --skip-data

# 仅上传数据文件（跳过静态资源）
node tools/upload-to-cos.mjs --data-only

# 模拟运行（不实际上传）
node tools/upload-to-cos.mjs --dry-run
`

### 上传内容

- public/assets/** → {prefix}/assets/
- public/fonts/** → {prefix}/fonts/
- data/*.json → {prefix}/data/

## 部署检查清单

### 1. 准备 COS 存储桶
- 在腾讯云控制台创建 COS 存储桶
- 配置 CORS 规则（允许跨域访问）
- 启用 CDN 加速（可选，推荐）

### 2. 配置环境变量
- 设置 SP_OBJECT_STORAGE_BUCKET
- 设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
- 设置 SP_ASSET_BASE_URL 和 SP_DATA_BASE_URL

### 3. 执行上传
`ash
node tools/upload-to-cos.mjs --dry-run  # 先测试
node tools/upload-to-cos.mjs            # 正式上传
`

### 4. 验证部署
- 启动服务器：npm start
- 访问 /runtime-config.json 检查配置
- 开发者工具 → Network 确认资源从 CDN 加载
- Application → Service Workers 检查 SW 注册
- Application → Cache Storage 检查 stronghold-v3 缓存

### 5. 测试离线模式
`ash
# 1. 正常启动游戏，等待资源缓存
# 2. 停止服务器
npm stop
# 3. 刷新浏览器 - 应仍可加载并进入单人模式
`

## CDN 配置建议

### 缓存规则
- 静态资源（/assets/*, /fonts/*）：缓存 30 天
- 数据文件（/data/*.json）：缓存 1 小时

### 性能优化
- 启用 Gzip / Brotli 压缩
- 启用 HTTP/2
- 强制 HTTPS

## 更新流程

### 更新静态资源
`ash
node tools/upload-to-cos.mjs --skip-data
# 清理 CDN 缓存
`

### 更新游戏数据
`ash
node tools/upload-to-cos.mjs --data-only
# 客户端会后台自动更新缓存
`

## 故障排查

### 资源加载失败
- 检查 CORS 配置
- 检查 CDN 缓存
- 验证环境变量

### Service Worker 未生效
- 开发者工具 → Application → Service Workers
- 点击 Update 强制更新
- 确认 /sw.js 可访问

### 离线模式不可用
- 确认已完整加载过一次
- 检查 Cache Storage → stronghold-v3
- 查看控制台 [sw] 日志

## 成本估算（ap-shanghai）

- 标准存储：¥0.118/GB/月
- 外网流量：¥0.50/GB

示例：500MB 资源，1000 月活用户，每人下载 3 次
- 存储：¥0.06/月
- 流量：¥750/月（直连）→ ¥75/月（CDN 90% 命中率）

## 相关文件

- tools/upload-to-cos.mjs - 上传脚本
- server/index.js - 服务器配置端点
- public/js/runtime.js - 运行时配置加载器
- public/js/assets.js - 资源加载器
- public/js/data.js - 数据加载器
- public/sw.js - Service Worker (v3)
- server/lobby.js - Solo 模式逻辑
