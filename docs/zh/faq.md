# 常见问题

## 安装后插件没有生效？

1. 确认安装的是对应 profile：
   `dsh plugin --profile <profile> add github:Yangxingyu789/dsh-doubt#v0.1.7`
2. 重启 harness 并刷新界面。
3. 在 **Settings → Plugins** 确认插件已启用。
4. 用 `dsh --profile <profile> --dump-config` 检查是否有 `- id: dsh-doubt`。

## 为什么 GitHub 安装不再需要构建？

因为仓库提交了构建后的 `lib/`。`dsh plugin add github:` 安装的是仓库内容，不会自动运行
`npm run build`；提交 `lib/` 是 DSH 插件的常见发布方式。

## 审核失败会怎样？

默认 fail-open：草稿会显示，但日志记录审核未完成。需要用户看到提示时，把
`reviewNotice` 设为 `banner` 或 `short`。审核是证据检查，不是正确性保证。

## 为什么我的回答被拦住了？

reviewer 发现了可执行断言与本轮工具证据不一致，或缺少关键证据。按提示补充真实工具结果，
或者把断言改成明确未验证。不要重复猜内部回执 id。

## `doubt_review` 是什么？我可以调用吗？

它是插件内部回执工具，会从模型工具列表隐藏。模型不应主动调用；旧会话诱发的误调用会被
拦截，避免反复消耗上下文。

## 闸门能当安全边界吗？

不能。它是启发式，覆盖常见 Windows/PowerShell/包装/解压/ACL/Node 写入形式，但任意代码
执行或不常见编码仍可能绕过。发现绕过请按 [SECURITY.md](../../SECURITY.md) 报告。

## 审核会增加多少 token？

每次审核会额外调用一次模型，输入包含请求、草稿和本轮工具证据，大小受 `reviewMaxChars`
限制。插件日志的 `审核用量` 记录字符数和 provider usage；未返回 usage 表示未知，不能当作
零。可用 `reviewMaterialOnly` 跳过没有实质断言的草稿。

## 支持哪些平台和版本？

Windows 是主要平台；Linux/macOS 支持开发和 CI。测试版本见
[兼容性](compatibility.md)。DSH 是预览版，插件契约可能变化。
