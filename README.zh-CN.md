# Norm APT 软件源

[English](README.md)

本仓库发布 [Norm](https://github.com/normlanguage/Norm) 面向 Debian 13 `amd64` 的已签名软件包。公开包索引位于 `https://normlanguage.github.io/apt/`。

安装软件源公钥并核对其指纹：

```sh
sudo apt update
sudo apt install ca-certificates curl gnupg
curl -fsSL https://normlanguage.github.io/apt/normlang-archive-keyring.asc -o normlang-archive-keyring.asc
gpg --show-keys --fingerprint normlang-archive-keyring.asc
```

主钥指纹必须是 `C18D 0A56 0CBE 44DE EA07  80A7 AA9F 118A A4EA 2A29`。然后添加一次软件源：

```sh
sudo install -m 644 normlang-archive-keyring.asc /usr/share/keyrings/normlang-archive-keyring.asc
printf 'Types: deb\nURIs: https://normlanguage.github.io/apt\nSuites: stable\nComponents: main\nArchitectures: amd64\nSigned-By: /usr/share/keyrings/normlang-archive-keyring.asc\n' | sudo tee /etc/apt/sources.list.d/normlang.sources >/dev/null
sudo apt update
sudo apt install normlang-archive-keyring normlang
```

如果此前已按旧版手工步骤添加此源，请运行一次 `sudo apt update && sudo apt install normlang-archive-keyring`。该包会接管现有公钥文件路径。之后使用 `sudo apt upgrade` 更新应用和公钥包，使用 `sudo apt remove normlang` 卸载应用并保留软件源公钥。Norm 将 Java 运行时和应用库保存在 `/usr/lib/normlang`；用户项目和下载的 Native 工具链留在用户主目录。

[发布工作流](.github/workflows/publish.yml)每天检查上游 Release 是否完整，原样保留已发布应用包的字节，仅使用[上游打包工具](https://github.com/normlanguage/Norm/blob/main/cli/compiler/scripts/apt-repository.mjs)构建缺失版本，在 Debian 13 上验证已签名 APT 安装、升级和卸载流程，然后通过 GitHub Pages 部署已验证的快照。每日检查不代表上游发布后立即触发发布。公钥包有独立版本；同一主钥和签名子钥的证书续期需要提高公钥包版本，并显式使用 `renew_signing_key` 输入。只要旧证书仍能认证软件源，已安装客户端即可通过 `sudo apt upgrade` 获取新证书。更换签名子钥或主钥指纹，以及客户端离线超过旧证书有效期的恢复，均需另行审查。
