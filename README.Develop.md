# 开发文档

## 环境准备

- Node.js 18+
- npm

## 依赖安装

```bash
npm install
```

## 本地开发

```bash
npm run dev
```

## 编译打包

Windows:
```bash
npm run build:win
```

macOS:
```bash
npm run build:mac          # 同时构建 x64 和 arm64
npm run build:mac-x64      # 仅 x64
npm run build:mac-arm64    # 仅 arm64
```

产物输出到 `dist/` 目录。

## 发布上传

需要先配置环境变量，复制 `env.example` 为 `.env` 并填写 OSS 配置。

```bash
npm run upload        # 仅当本地版本更新时上传
npm run upload:force  # 强制上传
```
