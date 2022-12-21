# World Banc

ローカルマシンのファイルをリスト表示・ダウンロードできるブラウザアプリ。

- 動作確認環境
  - Windows : GitBash
  - MacOS
  - Linux (WSL Ubuntu)
- 構成ファイル
  - サーバサイド : `index.js` のみ (`express`・`drivelist` に依存)
  - クライアントサイド : `index.html` のみ (内部に Favicon Base64・CSS・JS を埋込)

```bash
# 環境変数と起動方法は次のとおり
$ WORLD_BANC_TOKEN=【トークン】 WORLD_BANC_PORT=【ポート】 WORLD_BANC_DDNS=【DDNS】 npm start
```

- 環境構築・`npm install` 時のトラブルシュート

```bash
# GitBash 上で Python を揃えても `drivelist` のインストールに失敗した
$ pacman -S python
$ python3 -V
Python 3.9.9

# PowerShell より `python3` コマンドを叩くと Microsoft Store が開き Python 3.10 をインストールできた
PS> python3
PS> python3 -V
Python 3.10.9
# PowerShell より `drivelist` をインストールしたあとは GitBash 上からも呼び出せた
```


## Links

- [Neo's World](https://neos21.net/)
