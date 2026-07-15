# 智映通学 · 前端

AI 驱动的计算机领域个性化多模态学习系统——前端应用。

## 技术栈

- **框架**：[Next.js 16](https://nextjs.org)（App Router，Turbopack）
- **UI**：[ShadCN](https://ui.shadcn.com)（base-ui 底层）+ [Tailwind CSS v4](https://tailwindcss.com)
- **表单**：[TanStack Form](https://tanstack.com/form) + [Zod](https://zod.dev)
- **包管理**：pnpm
- **后端**：Rust Axum（REST API，见 sibling 仓库 `zhiying-backend`）

## 快速开始

### 环境要求

- Node.js 20+
- pnpm 9+
- 后端服务运行在 `http://localhost:9000`（见 `zhiying-backend`）

### 启动开发服务器

```bash
# 安装依赖
pnpm install

# 配置环境变量（首次）
cp .env.example .env.local
# 编辑 .env.local，确认 BACKEND_API_URL 指向后端地址

# 启动
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000) 查看应用。

### 构建

```bash
pnpm build
pnpm start
```

## 项目结构

```
src/
├── app/                    # Next.js App Router 页面
│   ├── (app)/              # 登录后管理型页面（Dashboard、错题本等）
│   ├── (auth)/             # 认证页面（登录、注册）
│   ├── api/auth/           # 认证代理 Route Handler
│   └── layout.tsx          # 根布局
├── components/
│   ├── ui/                 # ShadCN 基础组件
│   ├── auth/               # 认证相关
│   ├── dashboard/          # Dashboard 专属
│   └── panels/             # 可复用面板
├── lib/
│   ├── api/                # API 客户端、Schema、错误处理
│   └── auth/               # 会话管理
```

## 协作文档

- `AGENTS.md`：项目长期约定与开发规范
- `PROGRESS.md`：当前开发进度与待办
