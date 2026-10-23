# 发布流程

仓库通过 annotated `vX.Y.Z` tag 发布 GitHub Release。Release workflow 会运行与 CI 相同
的检查，构建插件 tarball 和源码 zip，并上传两个资产。

## 1. 准备版本

更新所有携带版本号的位置：

- `package.json`（`version`、`dsh.install` URL）
- `dsh-plugin.json`
- `src/index.ts`
- `test/host.test.mjs`
- `README.md` / `README.zh-CN.md`（徽章、固定 tag 的命令）
- `CHANGELOG.md`
- `docs/release-notes-<version>.md`
- `docs/provenance.md`（增加当前 release 行）

提交前先构建，保证仓库里的 `lib/` 与源码一致：

```bash
npm run check
npm run build
npm test
npm run smoke
npm run audit
```

`lib/` 是故意提交的：DSH 的 `dsh plugin add github:...` 直接把仓库作为插件安装，不会运行
构建步骤。

## 2. 验证

```bash
npm run verify                 # 本机；有 DSH_APP_DIR 时包含宿主测试
npm pack --dry-run             # 检查包内容
```

等待 `main` 的 CI 矩阵通过。

## 3. 打 tag 并发布

```bash
git add -A
git commit -m "release: X.Y.Z"
git push origin main
git tag -a vX.Y.Z -m "dsh-doubt X.Y.Z"
git push origin vX.Y.Z
```

Release workflow 会：

1. 在 Windows 上运行检查（`npm run check/build/test/smoke/audit`）。
2. 在 Ubuntu 上打包（`npm pack`、源码 zip）。
3. 用 `gh release create` 创建 Release，正文来自
   `docs/release-notes-X.Y.Z.md`。

## 4. 验证 Release

- Release 不是 draft/prerelease，两个资产都存在且可下载。
- tarball 内含 `package/lib/index.js`，版本号正确。
- 在一次性 profile 中执行
  `dsh plugin --profile <test> add github:<owner>/<repo>#vX.Y.Z`
  可以安装。
- 仓库公开页、topics 和社区文件保持正确。

## 回滚

已发布的 tag 视为不可变。发现坏版本时发布新的 patch 版本，而不是移动 tag。若在公告前
确认无人安装，才考虑删除远端 tag/release 后重新打 tag。
