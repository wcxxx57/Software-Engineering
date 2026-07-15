# zhiying-meta（历史资料）

该目录来自 `zhiying-tutor` 原多仓库时期的伞型 meta-repo。项目现已整合到上级单仓库，实际代码目录均位于上级目录中，并统一由上级 [`README.md`](../README.md)、[`compose.yaml`](../compose.yaml) 和 [`justfile`](../justfile) 管理。

本目录保留 `ARCHITECTURE.md`、旧 Compose 和旧协作资料，主要用于追溯设计背景；其中关于 `bootstrap`、分别 clone 多个 sibling repo 的内容已经不再适用于当前单仓库。

## 包含

- [`AGENTS.md`](./AGENTS.md) — 跨仓库的协作约定（子仓库各自有独立 `AGENTS.md`，进入子目录自动加载）。
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — 跨仓库的技术全景（分层、状态机、解锁链、异步生成流、数据模型）。
- [`justfile`](./justfile) — 引入全部子模块的 `just` 入口；提供 `bootstrap` / `sync` / `up` / `down` / `ps`。

## 子仓库

通过 `just bootstrap` 平级 clone 到本目录，各自独立 git 历史：

| 目录 | 角色 |
|---|---|
| `zhiying-infra/` | 共享中间件（PostgreSQL + RabbitMQ）的 docker compose |
| `zhiying-backend/` | 主后端（Rust + Axum + SeaORM） |
| `zhiying-mocks/` | 7 个微服务的 mock（Python + uv） |
| `zhiying-frontend/` | Web 前端（Next.js + pnpm） |
| `zhiying-ui/` | 静态 HTML 视觉/交互原型 |

`just up` 后会有更多由队友维护的真实微服务接入（视频生成等）；它们自己在 GitHub 组织下有独立 repo，本地联调时可手动 clone 或扩到 `justfile` 的 `sub_repos` 里。

## 原多仓库起步方式（仅供历史参考）

```bash
git clone git@github.com:zhiying-tutor/zhiying-meta.git zhiying-tutor
cd zhiying-tutor
just bootstrap          # clone 5 个子仓库
just up                 # 拉起整套本地栈
just ps                 # 查看正在运行的 tmux session 与 compose 服务
just down               # 反序停掉
just sync               # 对所有子仓库 git pull --ff-only
just status             # 跨仓库 short status 速览
```

## 子仓库快捷调用

`just <repo> <recipe>` 透传到对应子仓库，例如：

```bash
just zhiying-backend serve     # cargo run，挂在 tmux session zhiying-backend
just zhiying-backend log       # tmux attach 进去看日志，C-b d 脱出
just zhiying-backend stop
just zhiying-mocks serve       # uv run zhiying-mocks
just zhiying-frontend typecheck
just zhiying-infra log         # docker compose logs -f
```

完整列表用 `just --list <repo>`。

## 当前使用建议

- 新开发、构建、部署和 Git 提交均从上级仓库根目录执行；
- 不再运行本目录 `just bootstrap` 或 `just sync`；
- 架构细节可继续参考本目录 `ARCHITECTURE.md`，但实际配置以根目录 Compose 和各服务代码为准。
