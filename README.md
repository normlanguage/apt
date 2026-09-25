# Norm APT repository

This repository publishes the signed Debian 13 `amd64` packages for [Norm](https://github.com/normlanguage/Norm). The public package index is at `https://normlanguage.github.io/apt/`.

Install the repository key and verify its fingerprint:

```sh
curl -fsSL https://normlanguage.github.io/apt/normlang-archive-keyring.asc -o normlang-archive-keyring.asc
gpg --show-keys --fingerprint normlang-archive-keyring.asc
```

The primary fingerprint must be `C18D 0A56 0CBE 44DE EA07  80A7 AA9F 118A A4EA 2A29`. Then add the source once:

```sh
sudo install -m 644 normlang-archive-keyring.asc /usr/share/keyrings/normlang-archive-keyring.asc
printf 'Types: deb\nURIs: https://normlanguage.github.io/apt\nSuites: stable\nComponents: main\nArchitectures: amd64\nSigned-By: /usr/share/keyrings/normlang-archive-keyring.asc\n' | sudo tee /etc/apt/sources.list.d/normlang.sources >/dev/null
sudo apt update
sudo apt install normlang
```

Use `sudo apt upgrade` for updates and `sudo apt remove normlang` to uninstall. Norm keeps its Java runtime and application libraries under `/usr/lib/normlang`; user projects and downloaded Native toolchains remain under the user's home directory.

[The publication workflow](.github/workflows/publish.yml) checks for a complete official release daily, retains byte-identical published packages, builds only missing versions with the [upstream package tool](https://github.com/normlanguage/Norm/blob/main/cli/compiler/scripts/apt-repository.mjs), validates the signed APT lifecycle in Debian 13, and deploys the verified snapshot through GitHub Pages. The daily check is not an immediate release trigger. Signing key renewal requires the explicit workflow input and an updated public key; clients must update their local keyring when its bytes change. A different fingerprint requires a separately reviewed rotation.
