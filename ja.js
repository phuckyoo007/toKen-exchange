// lib/i18n/ja.js
// Japanese localization. Must define the exact same `strings` keys and the
// exact same FAQ `id`s as lib/i18n/en.js -- lib/i18n.js falls back to en.js
// for anything missing here, and test-i18n.js checks the key sets match.
(function () {
  const strings = {
    "common.needHelp": "お困りですか?",
    "common.languageLabel": "言語",
    "common.back": "戻る",
    "common.cancel": "キャンセル",
    "common.copy": "コピー",
    "common.send": "送金",
    "common.swap": "スワップ",
    "common.buy": "購入",
    "common.livePrices": "リアルタイム価格",
    "common.reject": "拒否",
    "common.passwordPlaceholder": "パスワード",
    "common.confirmPasswordPlaceholder": "パスワード（確認）",
    "common.newPasswordLabel": "新しいパスワード（8文字以上）",
    "common.addressPlaceholder0x": "0x...",
    "common.tokenAddressPlaceholderParen": "トークンアドレス（0x...）",
    "common.amountPlaceholder": "0.0",
    "common.nativeCoinOption": "ネイティブコイン",

    "onboarding.title": "ようこそ",
    "onboarding.subtitle": "まずはウォレットを設定しましょう。",
    "onboarding.createBtn": "新しいウォレットを作成",
    "onboarding.importBtn": "既存のウォレットをインポート",

    "create.title": "ウォレットを作成",
    "create.passwordLabel": "新しいパスワード（8文字以上）",
    "create.passwordWarning": "このパスワードは、このデバイス上でウォレットのロックを解除するためのものです。パスワードを忘れた場合の復旧手段はありません。資産を復元できるのはリカバリーフレーズだけです。",
    "create.continueBtn": "続ける",
    "create.backupWarning": "このリカバリーフレーズを紙に書き留め、安全な場所に保管してください。これを知っている人は誰でもこのウォレット内のすべての資産を持ち出せます。Token Exchange がこれを復元することはできません。",
    "create.backupCheckbox": "リカバリーフレーズを保存しました",
    "create.finishBtn": "完了",

    "import.title": "ウォレットをインポート",
    "import.mnemonicLabel": "リカバリーフレーズ（12語または24語）",
    "import.mnemonicPlaceholder": "word1 word2 word3 ...",
    "import.submitBtn": "インポート",

    "unlock.title": "ロック解除",
    "unlock.submitBtn": "ロック解除",
    "unlock.resetInsteadBtn": "代わりにウォレットをリセット",

    "main.settingsTitle": "設定",
    "main.tokensTitle": "トークン",
    "main.addTokenBtn": "+ トークンを追加",
    "main.tokensEmpty": "まだトークンが追加されていません。「+ トークンを追加」をタップし、コントラクトアドレスを入力すると残高を表示できます。",
    "main.networkLabel": "ネットワーク",
    "main.balanceFetchErrorPrefix": "残高を取得できませんでした: ",

    "tokens.loadError": "残高を読み込めませんでした",
    "tokens.removeTitle": "削除",

    "addToken.title": "トークンを追加",
    "addToken.description": "現在のネットワークでのトークンのコントラクトアドレスを入力してください。信頼できる情報源から入手したコントラクトアドレスのみを追加してください。ウォレットは、同じ名前の本物のトークンと偽物のトークンを見分けることはできません。",
    "addToken.addressLabel": "トークンのコントラクトアドレス",
    "addToken.lookupBtn": "検索",
    "addToken.nameLabel": "名称:",
    "addToken.symbolLabel": "シンボル:",
    "addToken.decimalsLabel": "小数点桁数:",
    "addToken.confirmBtn": "ウォレットに追加",
    "addToken.invalidAddress": "有効なコントラクトアドレスを入力してください。",
    "addToken.noName": "（名称なし）",
    "addToken.swapUnavailableSuffix": "（スワップ利用不可）",

    "prices.description": "CoinGecko の公開 API による米ドル建て価格です。あくまで参考情報であり、この価格取得のためにウォレットの情報が送信されることはありません。",
    "prices.loading": "読み込み中...",
    "prices.naText": "該当なし",

    "buy.title": "暗号資産を購入",
    "buy.description1": "購入機能は、独立した第三者サービスである MoonPay によって提供されています。Token Exchange がお客様の支払い情報に触れることは一切ありません。",
    "buy.description2Html": "MoonPay が新しいタブで開きます。このウォレットは、お客様の代わりに受取アドレスを MoonPay に送信することはありません（それには秘密鍵で署名したリクエストが必要になりますが、秘密鍵をブラウザ拡張機能の内部に置くことは絶対にあってはなりません。詳しくは <code>lib/buy-config.js</code> をご覧ください）。MoonPay のタブが開いたら、<strong>受取アドレスはご自身で貼り付けて</strong>ください。",
    "buy.continueBtn": "MoonPay に進む",

    "support.title": "ヘルプ＆サポート",
    "support.description": "質問を入力するか、下のトピックをタップしてください。この機能はすべてお使いのデバイス上で完結しており、ここに入力した内容が外部に送信されることはありません。",
    "support.inputPlaceholder": "質問を入力...",

    "send.title": "送金",
    "send.assetLabel": "資産",
    "send.assetToken": "トークン（コントラクトアドレスを入力）",
    "send.tokenAddressPlaceholder": "トークンのコントラクトアドレス（0x...）",
    "send.toLabel": "送付先アドレス",
    "send.amountLabel": "数量",
    "send.invalidRecipient": "有効な送付先アドレスを入力してください。",
    "send.invalidTokenAddress": "有効なトークンのコントラクトアドレスを入力してください。",
    "send.sentStatus": "送金が完了しました。トランザクションハッシュ: {txHash}",

    "swap.unsupportedWarning": "このネットワークではまだスワップを利用できません（検証済みのルーターが設定されていません）。まず「設定」→「ネットワーク」から追加してください。",
    "swap.fromLabel": "スワップ元",
    "swap.toLabel": "スワップ先",
    "swap.getQuoteBtn": "見積もりを取得",
    "swap.appFeeLine": "アプリ手数料（{percent}）: {amount}",
    "swap.netAmountLine": "実際にスワップされる金額: {amount}",
    "swap.estimatedOutLine": "受け取り予定額: {amount}",
    "swap.slippageLabel": "スリッページ許容度",
    "swap.approveBtn": "先にトークンを承認",
    "swap.approvingStatus": "承認中...",
    "swap.approvedStatus": "承認が完了しました。スワップを実行できます。",
    "swap.sendingStatus": "手数料の送付とスワップを処理中...",
    "swap.swappedStatus": "スワップが完了しました。手数料のトランザクション: {feeTx} | スワップのトランザクション: {tx}",
    "swap.feeTxNa": "該当なし",

    "settings.title": "設定",
    "settings.addAccountBtn": "アカウントを追加",
    "settings.importKeyBtn": "秘密鍵をインポート",
    "settings.addNetworkBtn": "ネットワークを追加",
    "settings.viewSeedBtn": "リカバリーフレーズを表示",
    "settings.helpBtn": "ヘルプ＆サポート",
    "settings.lockBtn": "ウォレットをロック",
    "settings.resetBtn": "ウォレットをリセット",

    "importKey.title": "秘密鍵をインポート",
    "importKey.placeholder": "0x から始まる秘密鍵",

    "addNetwork.title": "ネットワークを追加",
    "addNetwork.namePlaceholder": "ネットワーク名",
    "addNetwork.chainIdPlaceholder": "チェーン ID（数値）",
    "addNetwork.rpcPlaceholder": "RPC の URL",
    "addNetwork.symbolPlaceholder": "ネイティブ通貨のシンボル",
    "addNetwork.explorerPlaceholder": "ブロックエクスプローラーの URL（任意）",
    "addNetwork.routerPlaceholder": "検証済みスワップルーターアドレス（任意）",
    "addNetwork.routerWarning": "ルーターアドレスは、プロジェクトの公式ドキュメントまたはそのチェーンのブロックエクスプローラーでご自身で確認できた場合にのみ入力してください。不明な場合は空欄のままにしてください。追加するまでは、このネットワークでのスワップは無効のままになります。",
    "addNetwork.addBtn": "追加",

    "viewSeed.title": "リカバリーフレーズ",
    "viewSeed.passwordPlaceholder": "表示するにはパスワードを入力",
    "viewSeed.revealBtn": "表示する",

    "reset.title": "ウォレットをリセット",
    "reset.warning": "この操作を行うと、このブラウザから暗号化されたウォレットが削除されます。リカバリーフレーズを必ずバックアップしてから実行してください。この操作は取り消せません。",
    "reset.confirmBtn": "はい、すべて削除します",

    "approve.unlockTitle": "続けるにはロックを解除してください",
    "approve.unlockOriginText": "{origin} がアクセスを要求しています。",
    "approve.connectTitle": "接続リクエスト",
    "approve.connectWantsText": "{origin} があなたのウォレットへの接続を求めています。",
    "approve.accountLabel": "アカウント: ",
    "approve.acceptConnectBtn": "接続する",
    "approve.txTitle": "トランザクションリクエスト",
    "approve.toLabel": "宛先:",
    "approve.valueLabel": "金額:",
    "approve.dataLabel": "データ:",
    "approve.txWarning": "このサイトを信頼しており、署名を求められている内容を理解している場合にのみ承認してください。",
    "approve.confirmBtn": "確認",
    "approve.signTitle": "署名リクエスト",
    "approve.signBtn": "署名する",
    "approve.addNetTitle": "ネットワーク追加リクエスト",
    "approve.addNetNameLabel": "名称:",
    "approve.addNetChainIdLabel": "チェーン ID:",
    "approve.addNetRpcLabel": "RPC:",
    "approve.addNetWarning": "このサイトが提案しているネットワークには検証済みのスワップルーターがありません。設定からご自身で追加するまで、このネットワークでのスワップは無効のままになります。",
    "approve.addNetBtn": "ネットワークを追加",
    "approve.contractCreation": "（コントラクト作成）",
    "approve.nativeSuffix": "（ネイティブコイン）",

    "loading.text": "読み込み中...",

    "footer.nonCustodial": "ノンカストディアル — 秘密鍵はこのデバイスの外に出ることはありません",

    "errors.passwordTooShort": "パスワードは8文字以上で入力してください。",
    "errors.passwordMismatch": "パスワードが一致しません。",
    "errors.unknownError": "不明なエラーが発生しました",
  };

  const faq = [
    {
      id: "create-wallet",
      chip: "ウォレットの作成方法は？",
      keywords: ["ウォレット 作成", "ウォレットを作成", "新規ウォレット", "ウォレット 新規作成", "はじめかた", "初めて", "セットアップ", "ウォレット セットアップ"],
      answer: "ようこそ画面で「新しいウォレットを作成」をタップし、パスワードを設定してください（このパスワードはこのデバイス上でウォレットのロックを解除するためだけのもので、資産の復元には使えません）。その後、12語のリカバリーフレーズが表示されます。続ける前に必ず安全な場所に書き留めてください。このデバイスを紛失した場合、資産を復元できる唯一の手段がそのフレーズです。",
    },
    {
      id: "import-wallet",
      chip: "既存のウォレットをインポートするには？",
      keywords: ["ウォレット インポート", "既存のウォレット", "ウォレット 復元", "リカバリーフレーズ インポート", "シードフレーズ インポート", "インポート方法"],
      answer: "ようこそ画面で「既存のウォレットをインポート」をタップし、12語または24語のリカバリーフレーズを記載通り正確に（小文字・半角スペース区切りで）入力したうえで、このデバイス用の新しいパスワードを設定してください。フレーズ自体がデバイスの外に送信されることはなく、アカウントの導出にローカルで使われるだけです。",
    },
    {
      id: "forgot-password",
      chip: "パスワードを忘れました",
      keywords: ["パスワード 忘れた", "パスワードを忘れた", "パスワード 違う", "ロック解除できない", "パスワード 間違い", "パスワード 反映されない", "ログインできない"],
      answer: "パスワードはこのデバイス上でウォレットのロックを解除するためだけのものです。Token Exchange はどこにもパスワードを保存しておらず、代わりにリセットすることもできません。パスワードを思い出せない場合は、ロック解除画面の「代わりにウォレットをリセット」をタップし、12語のリカバリーフレーズを使ってウォレットを再度インポートしてください。そのフレーズを保存していない場合、残念ながらこのウォレットの資産を復元する方法はありません。それがノンカストディアルウォレットの特性です。あなた以外の誰もロックを解除できない代わりに、あなた以外の誰も救済することができません。",
    },
    {
      id: "lost-seed-phrase",
      chip: "リカバリーフレーズを紛失しました",
      keywords: ["シードフレーズ 紛失", "リカバリーフレーズ 紛失", "リカバリーフレーズ ない", "フレーズを失くした", "書き留めていない", "保存し忘れた", "フレーズ 忘れた"],
      answer: "まだログインできている場合は、「設定」→「リカバリーフレーズを表示」からパスワードを再入力し、今すぐ安全な場所に書き留めてください。ロックされていて、かつフレーズを一度も保存していない場合、ウォレットや中の資産を復元する方法はありません。Token Exchange はリカバリーフレーズをサーバーやクラウドなど、どこにも一切保存していないため、開発者を含め誰もそれを取得することはできません。",
    },
    {
      id: "balance-not-showing",
      chip: "残高が表示されません",
      keywords: ["残高", "残高 ゼロ", "残高 0", "残高 表示されない", "残高 おかしい", "読み込み中のまま", "残高 反映されない"],
      answer: "残高が「...」のまま止まっている場合、多くはそのネットワークの RPC エンドポイントが遅延しているか一時的にダウンしていることが原因です。このウォレットは数秒後に自動でバックアップのエンドポイントに切り替えて再試行するため、通常は自然に解消します。0 のまま確定していておかしいと感じる場合は、正しいネットワークと正しいアカウントが選択されているか（どちらもメイン画面のドロップダウンにあります）を確認してください。残高はネットワークごと、アカウントごとに別々に管理されているため、たとえば Ethereum Mainnet が選択されている間は Base 上の資産は表示されません。",
    },
    {
      id: "swap-failed",
      chip: "スワップに失敗しました",
      keywords: ["スワップ 失敗", "スワップ できない", "スワップ エラー", "スワップ 動かない", "見積もり 失敗", "スワップ 止まる"],
      answer: "スワップは公開の分散型取引所のルーターを通じてオンチェーンで行われるため、失敗する原因は主に3つです。1つ目はスワップ額とガス代を合わせた残高が不足している、2つ目は価格変動が速いのにスリッページ許容度が厳しすぎる（0.5% ではなく 1% や 3% を試してください）、3つ目はそのネットワークのルーターにそのトークンペアの十分な流動性がまだない、というものです。「見積もりを取得」の後に表示されるエラー内容が原因の手がかりになります。不明な場合は、まず少額で試してみてください。",
    },
    {
      id: "swap-fee",
      chip: "スワップの手数料はいくらですか？",
      keywords: ["スワップ 手数料", "手数料 いくら", "0.5%", "スワップ 料金", "手数料について", "手数料はいくら"],
      answer: "スワップにはスワップ額に対して一律 0.5% の手数料がかかり、確認する前に見積もり画面に明示されます。これはスワップのトランザクション自体に含まれるもので、為替レートに隠された上乗せではありません。この手数料は、ブロックチェーンに支払われる（Token Exchange には渡らない）ガス代とは別のものです。",
    },
    {
      id: "gas-fees",
      chip: "ガス代とは何ですか？",
      keywords: ["ガス代", "ネットワーク手数料", "トランザクション手数料", "ガスとは", "ガス代 いくら"],
      answer: "ガス代は、トランザクションを処理するためにブロックチェーンのネットワーク自体が徴収する手数料であり、Token Exchange のスワップ手数料（0.5%）とは別物で、全額がネットワークに支払われ、当社には入りません。金額はその時のネットワークの混雑状況によって変動します。トークンを送る場合でも、ガス代を賄うためにそのネットワークのネイティブコイン（ETH、BNB、POL など）を十分に保有しておいてください。",
    },
    {
      id: "add-network",
      chip: "ネットワークを追加するには？",
      keywords: ["ネットワーク 追加", "新しいネットワーク", "カスタムネットワーク", "別のチェーン", "他のチェーン"],
      answer: "「設定」→「ネットワークを追加」から、ネットワーク名、チェーン ID、RPC の URL、ネイティブ通貨のシンボルを入力してください。検証済みのスワップルーターアドレスも併せて入力すれば、そのネットワークでもスワップが利用できるようになります。入力しない場合は送金・受け取りのみ対応します。値は必ずそのネットワークの公式ドキュメントかブロックエクスプローラーでご自身で確認したものを使用してください。",
    },
    {
      id: "add-token",
      chip: "トークンを登録するには？",
      keywords: ["トークン 追加", "トークン 登録", "新しいトークン", "カスタムトークン", "ERC-20", "ERC20", "トークンを追加したい"],
      answer: "メイン画面で「+ トークンを追加」をタップし、現在のネットワークにおけるそのトークンのコントラクトアドレスを貼り付けて「検索」をタップしてください。コントラクトから直接、名称・シンボル・小数点桁数が読み込まれるので、追加する前に内容を確認できます。信頼できる情報源から入手したコントラクトアドレスのみを追加してください。ウォレットは、同じ名前やシンボルを使った偽トークンを本物と見分けることができません。",
    },
    {
      id: "send-crypto",
      chip: "暗号資産を送るには？",
      keywords: ["送金方法", "暗号資産 送る", "トークン 送る", "送金のやり方", "ETH 送金", "資産を送る"],
      answer: "メイン画面で「送金」をタップし、ネイティブコインかトークン（コントラクトアドレスで指定）を選び、送付先のアドレスと数量を入力して確認してください。確定する前に必ずアドレスを再確認してください。これらのネットワーク上での送金は、一度承認されると取り消すことができません。",
    },
    {
      id: "connect-dapp",
      chip: "サイトに接続するには？",
      keywords: ["サイトに接続", "dApp 接続", "接続できない", "ウォレット接続 ボタン", "つながらない"],
      answer: "ブラウザ拡張機能のウォレットに対応した「Connect Wallet」ボタンがあるサイトなら、MetaMask や Coinbase Wallet と同じように Token Exchange も選択肢として表示されるはずです。表示されない場合は、ウォレットをインストールしてロックを解除した状態でページを再読み込みしてみてください。サイトによっては、ページの読み込み時にしかウォレット拡張機能を検出しないことがあります。",
    },
    {
      id: "buy-not-working",
      chip: "購入機能が使えません",
      keywords: ["購入 使えない", "購入できない", "購入 動かない", "購入 未設定", "MoonPay", "買えない"],
      answer: "「購入」ボタンをタップすると、独立した第三者のオンランプサービスである MoonPay が新しいタブで開きます。「購入機能はまだ設定されていません」と表示される場合、このウォレットの開発者がまだ MoonPay の API キーを設定していないことを意味しており、ウォレット内から解決できるものではありません。設定が完了すると、MoonPay のページにご自身で受取アドレスを貼り付ける形になります。Token Exchange が代わりに送信することはありません。",
    },
    {
      id: "reset-wallet",
      chip: "ウォレットをリセットするには？",
      keywords: ["ウォレット リセット", "ウォレット 削除", "最初からやり直す", "ウォレット 消す", "ウォレット 初期化"],
      answer: "「設定」→「ウォレットをリセット」を選ぶと、このブラウザから暗号化されたウォレットが完全に削除されます。実行する前に、必ずリカバリーフレーズをバックアップ済みであることを確認してください。この操作は取り消せず、そのフレーズがなければリセット後にウォレットを元に戻す方法はありません。",
    },
    {
      id: "is-it-safe",
      chip: "このウォレットは安全ですか？",
      keywords: ["安全ですか", "信用できる", "ノンカストディアル", "カストディアル", "セキュリティ", "詐欺ですか", "本物ですか"],
      answer: "Token Exchange はノンカストディアル（非管理型）のウォレットです。リカバリーフレーズと秘密鍵は暗号化された状態でお使いのブラウザにのみ保存され、サーバーへ送信されることはありません。そもそもサーバー自体が存在しないためです。これは同時に、パスワードとリカバリーフレーズの両方を紛失した場合、開発者を含め誰も資産を復元できないことも意味します。送金・スワップは送信前にデバイス上で同梱の制裁リストと照合され、スワップ手数料も確認前に必ず明示されます。",
    },
    {
      id: "pending-transaction",
      chip: "トランザクションが止まっています",
      keywords: ["ペンディング", "トランザクション 止まる", "承認されない", "処理中のまま", "トランザクション 詰まる"],
      answer: "ネットワークが混雑していたり、設定したガス代がその時の状況に対して低すぎたりすると、トランザクションが「保留中（pending）」のままになることがあります。多くの場合は時間が経てば自動的に承認されます。長時間止まったままの場合は、アカウントアドレスを使ってそのネットワークのブロックエクスプローラーでトランザクションを検索し、リアルタイムの状況を確認できます。",
    },
    {
      id: "wrong-network",
      chip: "対応しているネットワークは？",
      keywords: ["対応ネットワーク", "ネットワーク 間違い", "ネットワーク 切り替え", "対応チェーン", "使えるチェーン", "どのネットワーク"],
      answer: "標準で Ethereum、Base、Polygon、BNB Chain、Arbitrum One、OP Mainnet に対応しており、メイン画面下部のドロップダウンから切り替えられます。残高・トークン・スワップの選択肢は、そこで選ばれているネットワークごとに異なります。それ以外の EVM 互換ネットワークも、「設定」→「ネットワークを追加」からご自身で追加できます。",
    },
    {
      id: "contact-human",
      chip: "もっとサポートが必要です",
      keywords: ["人と話したい", "担当者に相談", "サポートに連絡", "問い合わせたい", "まだ解決しない", "もっと助けが必要", "オペレーターに相談"],
      answer: "__CONTACT_FALLBACK__",
    },
  ];

  const greeting = "こんにちは。私はシンプルな内蔵ヘルプボットです。あらかじめ用意された固定リストの質問にのみお答えできます。下のトピックをタップするか、質問を直接入力してください。";
  const fallbackWithEmail = "その質問に対する回答はまだ用意されていません。{email} まで担当者にご連絡いただけます。どの画面で何が起きたか、何を期待していたかを添えていただけるとスムーズです。";
  const fallbackNoEmail = "その質問に対する回答はまだ用意されておらず、このウォレットには現時点で有人のサポート窓口も設定されていません。質問の言い回しを変えて試すか、拡張機能の README で各機能の詳しい説明をご確認ください。";

  self.TM_I18N_DATA = self.TM_I18N_DATA || {};
  self.TM_I18N_DATA.ja = {
    name: "日本語",
    dir: "ltr",
    strings,
    faq,
    greeting,
    fallbackWithEmail,
    fallbackNoEmail,
  };
})();
