# Vector Storage - LanceDB Edition

基于官方 Vector Storage 扩展，内置 LanceDB 支持。

## 📦 文件结构

```
Vector-Storage-5053/
├── index.js              # 主扩展逻辑（已集成 LanceDB 支持）
├── backend-interface.js  # 抽象后端接口
├── lancedb-backend.js    # LanceDB 后端实现
├── lancedb-wrappers.js   # LanceDB API 包装器
├── webllm.js            # WebLLM 集成
├── settings.html        # 设置界面
├── style.css            # 样式
└── manifest.json        # 元数据
```

## ✨ 主要特性

1. **双后端支持**
   - 优先使用 LanceDB 后端（如果启用）
   - 自动降级到官方 API（兼容模式）

2. **服务器端 LanceDB**
   - 通过 Express routes 暴露 API
   - 无需客户端直接依赖 LanceDB npm 包
   - 更轻量，启动更快

3. **渐进式迁移**
   - 从官方 API 平滑过渡到 LanceDB
   - 支持混合使用两种后端

## 🔧 安装步骤

### 1. 准备 Server Plugin（可选但推荐）

在 `SillyTavern/plugins/` 目录下创建 `uwu-memory` 插件：

```bash
cd SillyTavern/plugins/
git clone https://github.com/ICSLI/SillyTavern-UwU-Memory.git uwu-memory
cd uwu-memory
npm install
```

### 2. 安装扩展

在 SillyTavern 扩展管理器中：

1. 点击 "Install Extension"
2. 输入 URL：
   ```
   https://github.com/YourName/Vector-Storage-5053
   ```
3. 点击 Save 等待安装完成
4. 刷新页面

### 3. 启用 LanceDB 后端

在扩展设置中：

1. 打开扩展设置面板
2. 勾选 "Use LanceDB Backend"
3. 保存设置

### 4. 配置 Server Plugin

编辑 `config.yaml`：

```yaml
enableServerPlugins: true
serverPlugins:
  - uwu-memory
```

重启 SillyTavern 后，插件会自动启动 Express 服务器。

## 🎛️ 配置选项

### 核心设置

- `source`: embedding 模型来源（transformers, openai, ollama 等）
- `useLanceDB`: 是否启用 LanceDB 后端
- `score_threshold`: 相似度阈值（0-1）
- `message_chunk_size`: 消息分块大小
- `depth`: 向量存储深度
- `protect`: 保护最近多少条消息不被向量化

### 后端选择

**LanceDB 模式**（推荐）：
- 需要启动 Server Plugin
- 性能更好，支持大规模数据
- 持久化存储

**官方 API 模式**（兼容）：
- 无需额外配置
- 适合快速测试
- 适合小规模数据

## 📝 使用方法

### 基础向量化

1. 打开扩展设置
2. 勾选 "Enabled Chats"
3. 开始聊天，系统会自动向量化消息

### 手动向量化

1. 打开扩展设置
2. 点击 "Vectorize All" 按钮
3. 等待进度完成

### 调试模式

在浏览器控制台：

```javascript
window.initLanceDBBackend();  // 初始化后端
window.lancedbBackend.healthCheck();  // 检查健康状态
window.lancedbBackend.list('ctx_sum_chat123');  // 列出向量
```

## 🔍 架构说明

### 数据流

```
[Chat] → [Summarize] → [Embed] → [Store]
                                    ↓
                            [LanceDB Backend]
                                    ↓
                           [Vector Search]
                                    ↓
                           [Inject Prompt]
```

### 后端架构

- **Abstract Backend**: 定义统一接口
- **LanceDBBackend**: 实现 LanceDB 通信
- **Wrappers**: 封装 API 调用逻辑

## 🚀 性能优化

### 推荐配置（大型上下文）

```
Depth: 10
Protect: 15
Insert: 5
Query: 3
Score Threshold: 0.3
Message Chunk Size: 500
```

### 推荐配置（快速测试）

```
Depth: 3
Protect: 5
Insert: 2
Query: 2
Score Threshold: 0.5
Message Chunk Size: 400
```

## 🐛 故障排查

### "LanceDB backend failed"

1. 检查 Server Plugin 是否启用
2. 查看控制台日志
3. 尝试降级到官方 API 模式

### "Vectorize All" 无反应

1. 确认 "Enabled Chats" 已勾选
2. 检查 embedding 模型是否可用
3. 查看进度条是否显示

## 📄 License

MIT License - See LICENSE file for details.

## 👤 Credits

- **Base**: Official Vector Storage by Cohee#1207
- **LanceDB Adaptation**: YourName
- **Inspired by**: UwU-Memory Architecture
