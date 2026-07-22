# ============================================================================
# Code2Video Docker 镜像
# 基于 Python 3.13 + Manim 依赖（LaTeX, ffmpeg, cairo, pango, 中文字体）
# ============================================================================

FROM python:3.13-slim AS base

# 避免交互式安装提示
ENV DEBIAN_FRONTEND=noninteractive

# 使用当前开发网络中更稳定的 Debian 镜像。每个依赖层都会在安装后验证
# 关键包和二进制，避免镜像源部分失败时静默生成不完整镜像。
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null || true

# ============================================================================
# 2. 安装系统依赖（分步安装，提高成功率）
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

# TeX Live 是 Manim MathTex 的硬依赖。安装成功后强制检查二进制，防止
# 重试循环在依赖缺失时仍生成表面成功、运行阶段失败的镜像。
RUN set -eux; \
    installed=0; \
    for i in 1 2 3; do \
        if apt-get update && apt-get install -y --no-install-recommends --fix-missing \
            texlive-latex-base \
            texlive-latex-extra \
            texlive-fonts-recommended \
            texlive-science \
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

# 直接安装运行时依赖，避免在源码 COPY 前触发 hatchling 项目构建。
# 阿里云镜像不可用时回退到官方 PyPI；业务源码在后续独立 COPY，代码变更
# 不会使这一层失效。
RUN python -c "import pathlib,tomllib; data=tomllib.loads(pathlib.Path('pyproject.toml').read_text(encoding='utf-8')); pathlib.Path('/tmp/requirements.txt').write_text('\\n'.join(data['project']['dependencies']) + '\\n', encoding='utf-8')" && \
    pip install --no-cache-dir -r /tmp/requirements.txt \
    --index-url https://mirrors.aliyun.com/pypi/simple/ \
    --extra-index-url https://pypi.org/simple \
    --trusted-host mirrors.aliyun.com \
    --timeout 120 --retries 5 && \
    rm -f /tmp/requirements.txt

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
