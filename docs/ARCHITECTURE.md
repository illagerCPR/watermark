# 架构说明

本文记录实现层面的关键决策与不变量，面向后续维护者。用户文档见 [README](../README.md)。

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 构建 | Vite 8（Rolldown / Lightning CSS） | `base` 在生产构建为 `/watermark/`，开发服务器为 `/` |
| UI | Vue 3.5 + TypeScript 5.9 | 组合式 API，无路由 / 无状态库 |
| 样式 | Tailwind CSS v4 | 颜色令牌映射到运行时 CSS 变量，`<html data-theme>` 切换主题 |
| 盲水印 | 原生 JS（逐行迁移自旧版 `blind.js`） | 以 `.js` + `.d.ts` 的形式保留算法原貌，供 Worker 复用 |
| 打包 | fflate | 批量导出 ZIP：Chrome/Edge 边处理边写盘，其他浏览器内存打包后下载 |
| 测试 | Vitest（单元）+ Playwright（E2E / 对拍） | E2E 双目标：dev server + 生产构建（`vite preview`，base=/watermark/） |

## 目录结构

```
src/
├── App.vue                      # 壳层：头部、视图切换、桌面侧栏 / 移动端抽屉
├── main.ts
├── components/
│   ├── layout/                  # AppHeader、ViewTabs、ParamPanel、ExtractDialog
│   ├── views/                   # SingleView、BatchView、ThumbCard
│   ├── fields/                  # FormField、RangeField、SwitchField
│   ├── feedback/                # ToastHost
│   └── ui/                      # AppIcon、SectionCard、icons.ts
├── composables/
│   ├── useParams.ts             # 全局参数单例 + localStorage 持久化 + 格式锁定
│   ├── useTheme.ts              # 深色/浅色主题
│   ├── useToasts.ts             # 轻量 toast 队列
│   └── useAppLock.ts            # 全局任务锁（同一时刻只跑一个盲水印任务）
├── core/
│   ├── blind/                   # 盲水印：algorithm.js/.d.ts、worker.ts、client.ts
│   ├── render/                  # watermark.ts（可见水印）、export.ts（编码/下载/命名）
│   ├── params.ts                # 默认值、清洗、签名
│   ├── storage.ts / image.ts / zip.ts / utils.ts / constants.ts / types.ts
├── styles/main.css              # Tailwind 入口、主题令牌、组件层
tests/
├── unit/                        # 算法往返、参数清洗、文件名
├── e2e/                         # 功能 E2E + 新旧对拍
└── parity/fixtures/             # 旧版 blind.js 基线（仅测试用）
```

## 核心原则：算法与 UI 解耦

`core/` 不依赖 Vue，`components/` 不直接写 Canvas 逻辑：

- `renderWatermark(ctx, image, params, options?)` 是唯一的可见水印绘制入口，单图预览、批量缩略图、单图导出、批量导出四处共用。缩略图通过 `scale` 参数按比例缩放字号/间距/描边，导出路径不传则为原分辨率。
- `core/blind/algorithm.js` 与旧版 `blind.js` 的算法逐行一致，仅做三处改动：ES 模块导出、把 `ImageData` 换成纯数据缓冲 `{ width, height, data }`、增加 `AbortSignal` 取消检查。`tests/e2e/parity.spec.ts` 会验证新旧实现的嵌入结果**逐字节相同**且可双向提取。
- `core/blind/client.ts` 对上层暴露 `embedBlind` / `extractBlind`：优先使用 Worker，构造失败时动态导入算法在主线程回退。

## 盲水印任务模型

- **Worker**：`worker.ts` 通过 `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` 创建；输入缓冲区以 Transferable 转移，输出同样零拷贝回传。
- **进度**：算法在 FFT 分片与提取窗口之间回调，Worker 通过 `progress` 消息转发；提取进度按「粗网格 0–50%，细网格 50–95%」映射，避免回跳。
- **取消**：FFT 计算无法从外部打断，`client.ts` 在收到 `AbortSignal` 时直接 `terminate()` Worker 并重建。算法内部也检查 signal，供主线程回退路径使用。
- **串行**：`useAppLock` 保证单图导出、批量导出、提取不会并发启动；否则取消一个任务会连带终止另一个任务。

## 可见水印

与旧版一致：

1. 以原始分辨率绘制原图；
2. 在离屏画布绘制一个平铺单元（最宽行 + 水平间距、行高 1.4×字号 × 行数 + 垂直间距）；
3. `createPattern` 平铺，以画布中心旋转后填充边长 2×对角线的矩形；
4. 关闭平铺或文本为空时只导出原图。

`hidden` 属性在旧版被 `.group.row { display: flex }` 覆盖导致「PNG 模式下仍显示 JPEG 质量」。新版用 `v-if` 控制条件渲染，E2E 中有对应回归测试。

## 批量导出与 ZIP 流式落盘

- `core/zip.ts` 用 `ZipWriter` + `ZipSink` 把 fflate 的同步回调接成 Promise 队列：每写完一个条目 await 一次形成反压，内存里最多只有当前图片的字节，不再需要先攒齐所有图片。
- 两种 sink：`createFileSink` 经 File System Access API 直接写入用户选定的文件（Chrome/Edge），`createMemorySink` 攒成 Blob 后触发下载（Firefox/Safari 回退）。
- 保存对话框必须在点击事件的同步调用栈里发起（用户手势），因此 `BatchView` 先选保存位置、再开始渲染；用户取消对话框按取消导出处理，`writable.abort()` 丢弃半成品。
- 写盘失败（磁盘满、权限被收回）视为整批故障：立即中止并提示，不逐张继续。
- ZIP 条目名经 `uniqueEntryName` 去重，条目仍是 store 模式（图片已压缩，不再二次压缩）。

## 盲水印算法（v2 瓦片架构）

- **嵌入**：在空频谱上生成一个 256×256 delta 瓦片——同步模板（半径 0.05N 的 4 峰星座 + 共轭镜像，随机相位，幅度 3α）+ 文本比特的幅度差分对（bit1：F(p1)=α∠φ、F(p2)=0；bit0 反之）——单次 IFFT 得到空间瓦片，按 256 周期平铺叠加到亮度通道。
- **强度**：`strength` 是空间波纹 RMS 下限（灰度级）。α 由 Parseval 反解，并按内容自适应提升到 ≥2×payload 带内容幅度中位数，保证强内容图也能提取。实测 s=1.5 时 RMSE≈1.5 灰度级。
- **提取**：两级滑窗（B/2 粗网格 + B/4 细网格）取 256² 块 → FFT → 幅度谱。瓦片的周期平铺使任意窗口恰含一个循环位移周期，幅度谱平移不变，因此天然抗平移/裁剪。先做星座匹配，再尝试旋转/缩放纯频域校正；成对频点按 `(m1-m2)/(m1+m2+1)` 归一化表决还原比特，魔数软门控（汉明距 ≤1）+ CRC8 硬裁决，2 块一致才采信。

### 不可破坏的不变量

- 嵌入/提取两端的位置序列必须完全一致：固定种子 `SEED` + `makePositionGen` 连续两次调用为一对。
- 不要再改回「分块重叠融合」方案：会导致窗间 delta 混合、无法解码。
- 表决不要改成符号投票或线性和：前者把强信号与噪声等权，后者会被单点强内容峰淹没。
- 门控不要加 `firstFound` 兜底：单块 CRC 侥幸通过会带来误检，宁可漏检。
- `BLOCK = 256`、`BAND_MIN/MAX = 0.12/0.35`、`RED_HEADER = 12`、`RED_MIN/MAX = 3/8`、`MAX_PAYLOAD = 200` 两端必须一致；UI 的 200 字节上限由单测与算法常量对齐。
- 小图（任一边 <256）在 UI 层即被拦截，不进入算法。

### 已知边界

任意角度旋转/缩放依赖插值后幸存的频谱峰，在方向性强的内容（大文字、规则纹理）上可能失败；sinc 插值损失不可逆，提高强度或冗余可缓解。负样本提取需要扫描全部窗口，尺寸越大越慢——这是提取提供进度与取消的原因。

## 状态与持久化

- `useParams` 持有唯一的 `reactive` 参数对象；组件直接读写它，不做多层 v-model 透传。
- 参数变化 250ms 防抖后写入 `localStorage`（键 `watermark.params`）；启动时经 `sanitizeParams` 清洗，越界数值、非法颜色/字体、未知格式都会被纠正。
- 主题存于 `watermark.theme`，`index.html` 内联脚本在首屏前应用，避免闪烁。
- 开启盲水印会把导出格式强制为 PNG（参数清洗与开关监听双重保证）。

## 测试策略

- **单元**：盲水印往返/负样本/取消/长度限制、参数清洗、文件名与 ZIP 去重。
- **对拍**：`tests/e2e/parity.spec.ts` 加载 `tests/parity/fixtures/legacy-blind.js`，对比同一输入的嵌入结果哈希，并做双向交叉提取。
- **E2E**：单图导出尺寸与命名、参数重绘、JPEG 质量行回归、盲水印闭环、尺寸拦截、批量 ZIP、跳过小图、未检测到、主题与参数持久化。
- **构建冒烟**：`tests/e2e/preview.spec.ts` 在 `vite build` 产物（base=/watermark/）上验证资源、导出与 Worker 全链路，并断言无 4xx 与控制台报错。
- **手工**：桌面 1440×900、移动 420×860、深浅两套主题截图走查。
