# 对拍基线

`fixtures/legacy-blind.js` 是重构前 `blind.js` 的原样副本（取自 `old` 分支，Unlicense），
仅用于 Playwright 对拍测试，不参与应用构建。

用途：

- 同一输入、同一参数下，新实现 `src/core/blind/algorithm.js` 的嵌入结果必须与它逐字节一致；
- 双向交叉提取必须成功，证明帧格式与位置序列完全兼容。

只有算法本身需要变更（例如提高压缩鲁棒性）时才允许更新这份基线，并同步更新测试期望。
