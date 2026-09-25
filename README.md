# Norm APT repository

This repository publishes the signed Debian 13 `amd64` packages for [Norm](https://github.com/normlanguage/Norm). The public package index is at `https://normlanguage.github.io/apt/`.

Install the repository key and verify its fingerprint:

```sh
sudo apt update
sudo apt install ca-certificates curl gnupg
curl -fsSL https://normlanguage.github.io/apt/normlang-archive-keyring.asc -o normlang-archive-keyring.asc
gpg --show-keys --fingerprint normlang-archive-keyring.asc
```

The primary fingerprint must be `C18D 0A56 0CBE 44DE EA07  80A7 AA9F 118A A4EA 2A29`. Then add the source once:

```sh
sudo install -m 644 normlang-archive-keyring.asc /usr/share/keyrings/normlang-archive-keyring.asc
printf 'Types: deb\nURIs: https://normlanguage.github.io/apt\nSuites: stable\nComponents: main\nArchitectures: amd64\nSigned-By: /usr/share/keyrings/normlang-archive-keyring.asc\n' | sudo tee /etc/apt/sources.list.d/normlang.sources >/dev/null
sudo apt update
sudo apt install normlang-archive-keyring normlang
```

If you already added this source using the earlier manual setup, run `sudo apt update && sudo apt install normlang-archive-keyring` once. The package takes ownership of the existing keyring path. Use `sudo apt upgrade` for subsequent application and keyring updates, and `sudo apt remove normlang` to uninstall the application while keeping the source key. Norm keeps its Java runtime and application libraries under `/usr/lib/normlang`; user projects and downloaded Native toolchains remain under the user's home directory.

[The publication workflow](.github/workflows/publish.yml) checks for a complete official release daily, retains byte-identical published application packages, builds only missing versions with the [upstream package tool](https://github.com/normlanguage/Norm/blob/main/cli/compiler/scripts/apt-repository.mjs), validates the signed APT lifecycle in Debian 13, and deploys the verified snapshot through GitHub Pages. The daily check is not an immediate release trigger. The keyring package has an independent version; renewing the same primary key and signing subkey requires a higher keyring version and the explicit `renew_signing_key` input. Installed clients receive the new certificate through `sudo apt upgrade` while the old certificate still authenticates the repository. A different signing subkey or primary fingerprint, and clients offline past the old certificate's validity, require separately reviewed recovery.
