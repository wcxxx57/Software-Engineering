# ============================================================================
# Code2Video Docker 镜像
# 基于 Python 3.13 + Manim 依赖（LaTeX, ffmpeg, cairo, pango, 中文字体）
# ============================================================================

FROM python:3.13-slim AS base

# 避免交互式安装提示
ENV DEBIAN_FRONTEND=noninteractive

# 当前开发网络访问 Debian 官方源不稳定，使用可达的镜像；每个安装层仍会
# 验证关键包和二进制，镜像源返回部分失败时不会静默通过。
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null || true

# ============================================================================
# 1. 安装系统依赖（分步安装，提高成功率）
# ============================================================================
# 先更新并安装基础工具
RUN apt-get update && \
    for i in 1 2 3; do \
        apt-get install -y --no-install-recommends --fix-missing \
            ffmpeg \
            libcairo2-dev \
            libpango1.0-dev \
            pkg-config \
            libegl1 \
            libgl1 \
            libgles2 \
            fonts-noto-cjk \
            build-essential \
            curl \
        && break || (echo "=== Base dependency retry $i ===" && sleep 5 && apt-get update); \
    done && \
    dpkg -s ffmpeg libcairo2-dev libpango1.0-dev fonts-noto-cjk >/dev/null && \
    rm -rf /var/lib/apt/lists/*

# TeX Live 是 Manim MathTex 的硬依赖。重试成功后必须检查二进制，防止
# 镜像源失败但 shell 循环仍以成功状态结束，最终在渲染阶段才暴露问题。
RUN set -eux; \
    installed=0; \
    for i in 1 2 3; do \
        if apt-get update && apt-get install -y --no-install-recommends --fix-missing \
            texlive-latex-base \
            texlive-latex-extra \
            texlive-fonts-recommended \
            dvisvgm; then \
            installed=1; \
            break; \
        fi; \
        echo "=== TeX Live dependency retry $i ==="; \
        sleep 5; \
    done; \
    test "$installed" = 1; \
    command -v latex; \
    command -v pdflatex; \
    command -v dvisvgm; \
    latex --version; \
    rm -rf /var/lib/apt/lists/*

# ============================================================================
# 2. 设置工作目录
# ============================================================================
WORKDIR /app

# ============================================================================
# 3. 安装 Python 依赖
# ============================================================================
# 先复制依赖文件，利用 Docker 缓存
COPY pyproject.toml ./

# 安装 pip 和项目依赖（使用国内镜像源，增加超时和重试）
RUN pip install --no-cache-dir --upgrade pip \
    -i https://mirrors.aliyun.com/pypi/simple/ \
    --trusted-host mirrors.aliyun.com \
    --timeout 120 --retries 5 && \
    pip install --no-cache-dir ".[dev]" \
    -i https://mirrors.aliyun.com/pypi/simple/ \
    --trusted-host mirrors.aliyun.com \
    --timeout 120 --retries 5

# ============================================================================
# 4. 复制项目代码
# ============================================================================
COPY src/ ./src/
COPY prompts/ ./prompts/

# 确保输出目录存在（运行时会通过 Volume 挂载）
RUN mkdir -p data/outputs/videos data/outputs/metadata src/CASES

# ============================================================================
# 5. 环境变量默认值
# ============================================================================
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    # Redis 默认连接（docker-compose 中会覆盖）
    REDIS_URL=redis://redis:6379/0 \
    CELERY_BROKER_URL=redis://redis:6379/0 \
    CELERY_RESULT_BACKEND=redis://redis:6379/0 \
    # API 配置
    API_HOST=0.0.0.0 \
    API_PORT=8080 \
    # 输出目录
    OUTPUT_DIR=data/outputs \
    VIDEO_DIR=data/outputs/videos \
    METADATA_DIR=data/outputs/metadata

# ============================================================================
# 6. 暴露端口
# ============================================================================
EXPOSE 8080

# ============================================================================
# 7. 默认启动命令（API 服务）
# ============================================================================
CMD ["python", "-m", "uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8080"]
