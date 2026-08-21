/**
 * SUNMIL — interface language.
 *
 * The server stays the authority on rules; this only decides what the player
 * reads. Server notices and refusals arrive as stable codes (`sold`,
 * `insufficient_coins`), so they localise here rather than shipping prose from
 * the API. Anything without a translation falls back to the English the server
 * sent, so a new server message is never a blank screen.
 */
export type Lang = 'en' | 'id';

type Dict = Record<string, string>;

const EN: Dict = {
  /* chrome */
  'rail.orders': 'Orders',
  'rail.market': 'Market',
  'rail.storage': 'Storage',
  'rail.expand': 'Expand',
  'rail.tasks': 'Tasks',
  'rail.build': 'Upgrade',
  'rail.board': 'Players',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.claim': 'Claim',
  'common.claimed': 'Claimed',
  'common.locked': 'Lvl {n}',
  'common.level': 'Level {n}',
  'common.free': 'Free',
  'common.done': 'Done',
  'common.next': 'Next',
  'common.skip': 'Skip',
  'common.sound': 'Sound',
  'common.language': 'Language',

  /* orders */
  'orders.title': 'Delivery Orders',
  'orders.sub': 'Fill the truck for coins, XP and $HAY',
  'orders.empty.big': 'The board is empty',
  'orders.empty.sm': 'New orders arrive as you play.',
  'orders.deliver': 'Deliver',
  'orders.missing': 'Missing items',
  'orders.skip': 'Skip',
  'orders.expires': 'leaves in {time}',

  /* market */
  'market.title': 'Roadside Market',
  'market.sub': 'Buy from neighbours or sell your surplus',
  'market.buy': 'Buy',
  'market.sell': 'Sell',
  'market.quiet.big': 'Market is quiet',
  'market.quiet.sm': 'Fresh listings show up every few minutes.',
  'market.nothing.big': 'Nothing to sell yet',
  'market.nothing.sm': 'Harvest crops and craft goods, then come back.',
  'market.listing': 'from {who} · {qty} left',
  'market.soldout': 'Sold out',
  'market.stock': 'You have {qty} · {price} each',
  'market.sell1': 'Sell 1',
  'market.sellAll': 'Sell all',

  /* storage */
  'storage.title': 'Storage',
  'storage.sub': 'Silo holds crops · Barn holds goods',
  'storage.silo': 'Silo',
  'storage.barn': 'Barn',
  'storage.emptySilo': 'No crops in your silo right now.',
  'storage.emptyBarn': 'No goods in your barn right now.',

  /* expand */
  'expand.title': 'Expand the Farm',
  'expand.sub': 'Spend coins and $HAY to grow',
  'expand.silo': 'Silo +{n} capacity',
  'expand.siloSub': 'More room for crops',
  'expand.barn': 'Barn +{n} capacity',
  'expand.barnSub': 'More room for goods',
  'expand.fields': 'More fields at Level {n}',
  'expand.fieldsSub': 'Reach the next level to clear new plots',
  'expand.upgrade': 'Upgrade',
  'expand.maxed': 'At maximum',

  /* machines + pens */
  'machine.sub': 'Queue up to {n} jobs',
  'machine.collect': 'Collect ready goods',
  'machine.make': 'Make',
  'machine.unlocks': 'Unlocks at Level {n}',
  'pen.sub': 'Feed with {feed}, collect {out}',
  'pen.tend': 'Feed all & collect all',
  'pen.counts': '{ready} ready · {hungry} hungry · {feed} in barn: {have}',
  'pen.animals': '{n} {kind}',
  'pen.hint': 'You can also tap animals directly out in the field — tap a feed bubble to feed, tap a product bubble to collect.',
  'pen.hens': 'hens',
  'pen.cows': 'cows',
  'pen.sheep': 'sheep',

  /* speed-up */
  'speedup.button': 'Finish now',
  'speedup.cost': 'Finish now for {hay} $HAY',
  'speedup.confirm': 'Finish this for {hay} $HAY?',

  /* upgrades */
  'upgrade.title': 'Upgrades',
  'upgrade.sub': 'Spend coins and $HAY on lasting capacity',
  'upgrade.slots': '{machine} — {slots} job slots',
  'upgrade.slotsSub': 'One more job on the line at a time',
  'upgrade.animals': '{pen} — {animals} animals',
  'upgrade.animalsSub': 'One more animal in the pen',
  'upgrade.maxed': 'Fully upgraded',
  'upgrade.buy': 'Buy',
  'upgrade.none.big': 'Nothing to upgrade yet',
  'upgrade.none.sm': 'Extra machine slots open at level {n}.',

  /* daily tasks */
  'tasks.title': 'Daily Tasks',
  'tasks.sub': 'Three every day. Finish all three for a bonus.',
  'tasks.progress': '{progress} / {target}',
  'tasks.guideMe': 'Show me',
  'tasks.allDone': 'All done today — see you tomorrow',
  'tasks.bonus': 'Bonus for all three',
  'task.plant': 'Plant {n} seeds',
  'task.harvest': 'Harvest {n} times',
  'task.craft': 'Start {n} craft jobs',
  'task.collect_machine': 'Collect {n} goods from machines',
  'task.feed': 'Feed {n} animals',
  'task.collect_pen': 'Collect {n} animal products',
  'task.deliver': 'Deliver {n} orders',
  'task.sell': 'Sell {n} items at the market',

  /* streak */
  'streak.title': 'Daily Reward',
  'streak.day': 'Day {n}',
  'streak.claim': 'Claim day {n}',
  'streak.claimed': 'Come back tomorrow',
  'streak.sub': 'Play on consecutive days for a bigger reward.',

  /* away */
  'away.title': 'While you were away',
  'away.sub': 'You were gone {time}',
  'away.crops': '{n} crops ripened',
  'away.goods': '{n} goods finished',
  'away.animals': '{n} animals produced',
  'away.go': 'Back to the farm',

  /* identity */
  'profile.title': 'Your Farm',
  'profile.sub': 'Other players see this name on their order board',
  'profile.name': 'Your name',
  'profile.farmName': 'Farm name',
  'profile.namePlaceholder': 'e.g. Ayu',
  'profile.farmPlaceholder': 'e.g. Sunrise Acres',
  'profile.taken': 'That name is taken',
  'profile.invalid': 'Use 2–20 letters, numbers or spaces',
  'board.title': 'Top Farmers',
  'board.sub': 'Ranked by level',
  'board.you': 'You',
  'board.rank': '#{n}',
  'board.empty.big': 'Nobody has named themselves yet',
  'board.empty.sm': 'Pick a name and you will be first.',

  /* tutorial */
  'tutorial.welcome.title': 'Welcome to Sunmil',
  'tutorial.welcome.body': 'Let me walk you through your first harvest. It takes about a minute.',
  'tutorial.start': 'Show me',
  'tutorial.later': 'I know what I am doing',
  'tutorial.step': 'Step {n} of {total}',
  'tutorial.done.title': 'That is the whole loop',
  'tutorial.done.body': 'Grow, craft, deliver, expand. Everything else builds on those four.',
  'tutorial.selectSeed': 'Pick a seed from the tray at the bottom.',
  'tutorial.plant': 'Now drag across your fields to plant. One sweep plants them all.',
  'tutorial.wait': 'Crops grow in real time. The bar over each plot shows how far along it is.',
  'tutorial.speedup': 'In a hurry? Tap a growing crop and pay $HAY to finish it now.',
  'tutorial.harvest': 'Tap a ripe crop to harvest it into your silo.',
  'tutorial.machine': 'Tap the Feed Mill to turn crops into feed.',
  'tutorial.queue': 'Choose a recipe and tap Make.',
  'tutorial.collect': 'Tap the mill again to collect what it made.',
  'tutorial.pen': 'Tap the coop, then feed your hens.',
  'tutorial.orders': 'The truck wants goods. Deliver an order for coins and $HAY.',
  'tutorial.tasks': 'Three tasks a day. Tap one and I will guide you through it.',

  /* guided task */
  'guide.title': 'Guide',
  'guide.stop': 'Stop guiding',
  'guide.taskDone': 'Task complete — claim your reward',
  'guide.plant': 'Pick a seed, then drag across your fields.',
  'guide.harvest': 'Tap a ripe crop to harvest it.',
  'guide.craft': 'Open a machine and start a job.',
  'guide.collect_machine': 'Open a machine with goods waiting and collect them.',
  'guide.feed': 'Open a pen and feed the animals.',
  'guide.collect_pen': 'Collect from an animal that is ready.',
  'guide.deliver': 'Open Orders and deliver one you can fill.',
  'guide.sell': 'Open the Market, switch to Sell, and sell some surplus.',

  /* intro + login */
  'intro.tagline': 'Farm & Craft Tycoon',
  'intro.blurb': 'A production-chain farm on Solana. Grow crops, feed animals, run the machines, fill the truck.',
  'intro.hint1': '<b>Sweep to plant.</b> Pick a seed below, then drag across your fields in one motion.',
  'intro.hint2': '<b>Tap anything ready.</b> Golden glow means harvest, collect, or claim.',
  'intro.hint3': '<b>Your farm keeps running</b> while you are away — the server holds the clock.',
  'intro.hintFast': '<b>Timers are sped up</b> so you can feel the whole loop in a few minutes.',
  'intro.hintReal': '<b>Crops take real time.</b> Wheat is ready in about {n} minutes.',
  'intro.start': 'Start farming',
  'login.blurb': 'Your farm lives on the server — crops keep growing while you are away.',
  'login.wallet': 'Connect wallet',
  'login.play': 'Start farming',
  'login.resume': 'Continue',
  'login.haveKey': 'I already have a farm key',
  'login.keyGone': 'That farm key no longer opens a farm. Start a new one, or paste the right key.',
  'login.noWallet': 'No Solana wallet found. Install Phantom, Solflare or Backpack.',
  'login.failed': 'Could not sign in with that wallet.',
  'login.rejected': 'You declined the signature. Nothing was sent.',
  'login.pick': 'Which wallet?',
  'login.noAccount': 'That {wallet} account cannot sign for SUNMIL. Switch to a Solana account and try again.',
  'login.pending': 'Your wallet is already asking — open it and finish there.',
  'login.disconnected': 'Your wallet is locked or on the wrong network.',
  'login.offline': 'Cannot reach the farm server.',
  'rail.mail': 'Mailbox',
  'mail.title': 'Mailbox',
  'mail.sub': 'What the neighbours sent you',
  'mail.from': 'from {who}',
  'mail.claim': 'Take it',
  'mail.empty.big': 'Nothing yet',
  'mail.empty.sm': 'Visit a neighbour and send something — most people send one back.',
  'visit.at': 'Visiting {who}',
  'visit.back': 'My farm',
  'visit.gift': 'Send a gift',
  'visit.readonly': 'You are visiting — that is their field, not yours.',
  'gift.title': 'Send a gift',
  'gift.sub': 'Out of your barn, to {who}',
  'gift.send': 'Send 3',
  'gift.have': 'you have {n}',
  'gift.sent': 'Sent {n} {item}',
  'gift.empty.big': 'Nothing to give',
  'gift.empty.sm': 'Harvest or craft something first, then come back.',
  'board.someone': 'a neighbour',
  'push.title': 'Tell you when it is ready?',
  'push.body': 'Your farm keeps working while you are away. We can let you know the moment there is something to collect.',
  'push.yes': 'Yes, tell me',
  'push.no': 'Not now',
  'push.on': 'We will let you know.',
  'login.retry': 'Try again',
  'login.ourFault': 'This is a problem on our side, not on your device.',
  'offline.blurb': 'SUNMIL cannot reach its farm server. Nothing is lost — your farm is kept on the server and will be exactly as you left it.',
  'offline.trying': 'Trying…',
  'key.title': 'Save your farm key',
  'key.blurb': 'This key is your farm. It is kept in this browser, and it is the only way back in if you clear your data or play somewhere else. Nobody can send it to you again.',
  'key.copy': 'Copy key',
  'key.copied': 'Copied',
  'key.copyManually': 'Select it and copy',
  'key.go': 'Saved it — play',
  'restore.title': 'Restore a farm',
  'restore.blurb': 'Paste the farm key you saved and your farm comes back exactly as you left it.',
  'restore.label': 'Farm key',
  'restore.submit': 'Restore',
  'restore.wrong': 'No farm matches that key.',
  'restore.back': 'Back',
  'invite.title': 'Closed beta',
  'invite.blurb': 'SUNMIL is invite-only for now. Enter your code to get in.',
  'invite.label': 'Invite code',
  'invite.submit': 'Enter',
  'invite.checking': 'Checking…',
  'invite.wrong': 'That code is not right.',
  'invite.tooMany': 'Too many tries. Wait a few minutes.',
  'invite.failed': 'Could not check that code.',
  'brand.official': 'Official address:',
  'brand.officialWarn': 'Only ever connect your wallet on this address.',

  /* notices from the server, by code */
  'notice.planted_partial': 'Only had coins for {n}',
  'notice.silo_nearly_full': 'Silo nearly full — sell or upgrade',
  'notice.barn_full': 'Barn is full',
  'notice.order_delivered': 'Delivered to {who} — +{coins} coins, +{hay} $HAY',
  'notice.sold': 'Sold {qty}× {item} — +{coins}',
  'notice.expand_done': 'Upgrade complete!',
  'notice.sped_up': 'Finished it early',
  'notice.machine_slot_added': '{machine} now runs {jobs} jobs',
  'notice.animal_added': 'A new arrival at the {pen}',
  'notice.task_claimed': 'Task done — +{coins} coins',
  'notice.tasks_all_done': 'All tasks done — +{coins} coins and {hay} $HAY bonus',
  'notice.streak_claimed': 'Day {day} — +{coins} coins, +{hay} $HAY',
  'notice.profile_saved': 'Saved',
  'notice.hay_withdraw_sent': 'Withdrawal submitted',
  'notice.hay_withdraw_review': 'Withdrawal received — held for review',
  'notice.hay_withdraw_failed': 'Withdrawal failed — $HAY returned',
  'notice.hay_deposited': 'Deposited {amount} $HAY',

  /* refusals from the server, by error code */
  'error.network': 'Cannot reach the farm server.',
  // A 500 used to reach players as the server's own bare wording. These three
  // say which of the two it is — the farm server, or the farm server's database —
  // because "Something went wrong" told a player nothing and an operator less.
  'error.server_error': 'The farm server hit a problem.',
  'error.db_unavailable': 'The farm server cannot reach its database.',
  'error.db_schema': 'The farm server is mid-update. Farms reopen once it finishes.',
  'error.unauthorized': 'Sign in to play',
  'error.guest_unknown': 'No farm matches that key',
  'error.forbidden': 'Not yours',
  'error.not_found': 'That is gone',
  'error.rate_limited': 'Slow down a moment',
  'error.level_locked': 'Not unlocked yet',
  'error.insufficient_coins': 'Not enough coins',
  'error.insufficient_hay': 'Not enough $HAY',
  'error.missing_items': 'Missing ingredients',
  'error.no_space': 'No room in storage',
  'error.not_ready': 'Still working',
  'error.queue_full': 'That queue is full',
  'error.disabled': 'Not available yet',
  'error.conflict': 'Someone got there first',
  'error.offline': 'Lost the connection to the farm',

  /* item names — the server sends English; these override for display */
  'item.wheat': 'Wheat',
  'item.corn': 'Corn',
  'item.carrot': 'Carrot',
  'item.soybean': 'Soybean',
  'item.sugarcane': 'Sugarcane',
  'item.egg': 'Egg',
  'item.milk': 'Milk',
  'item.wool': 'Wool',
  'item.cfeed': 'Chicken Feed',
  'item.vfeed': 'Cow Feed',
  'item.sfeed': 'Sheep Feed',
  'item.bread': 'Bread',
  'item.cake': 'Carrot Cake',
  'item.cream': 'Cream',
  'item.butter': 'Butter',
  'item.sugar': 'Sugar',
  'item.syrup': 'Syrup',
  'item.tomato': 'Tomato',
  'item.strawberry': 'Strawberry',
  'item.pumpkin': 'Pumpkin',
  'item.cheese': 'Cheese',
  'item.soup': 'Garden Soup',
  'item.jam': 'Berry Jam',
  'item.pie': 'Pumpkin Pie',
  'machineName.mill': 'Feed Mill',
  'machineName.bakery': 'Bakery',
  'machineName.dairy': 'Dairy',
  'machineName.sugar': 'Sugar Mill',
  'machineName.kitchen': 'Kitchen',
  'penName.chicken': 'Chicken Coop',
  'penName.cow': 'Cow Pasture',
  'penName.sheep': 'Sheep Fold',

  /* durations */
  'time.s': '{n}s',
  'time.m': '{n}m',
  'time.h': '{n}h',
  'time.hm': '{h}h {m}m',
};

const ID: Dict = {
  'rail.orders': 'Pesanan',
  'rail.market': 'Pasar',
  'rail.storage': 'Gudang',
  'rail.expand': 'Perluas',
  'rail.tasks': 'Tugas',
  'rail.build': 'Tingkatkan',
  'rail.board': 'Pemain',
  'common.close': 'Tutup',
  'common.cancel': 'Batal',
  'common.save': 'Simpan',
  'common.claim': 'Ambil',
  'common.claimed': 'Sudah diambil',
  'common.locked': 'Lvl {n}',
  'common.level': 'Level {n}',
  'common.free': 'Gratis',
  'common.done': 'Selesai',
  'common.next': 'Lanjut',
  'common.skip': 'Lewati',
  'common.sound': 'Suara',
  'common.language': 'Bahasa',

  'orders.title': 'Pesanan Antar',
  'orders.sub': 'Isi truk untuk koin, XP dan $HAY',
  'orders.empty.big': 'Papan pesanan kosong',
  'orders.empty.sm': 'Pesanan baru datang sambil kamu bermain.',
  'orders.deliver': 'Antar',
  'orders.missing': 'Barang kurang',
  'orders.skip': 'Lewati',
  'orders.expires': 'hangus dalam {time}',

  'market.title': 'Pasar Pinggir Jalan',
  'market.sub': 'Beli dari tetangga atau jual kelebihanmu',
  'market.buy': 'Beli',
  'market.sell': 'Jual',
  'market.quiet.big': 'Pasar sedang sepi',
  'market.quiet.sm': 'Barang baru muncul tiap beberapa menit.',
  'market.nothing.big': 'Belum ada yang bisa dijual',
  'market.nothing.sm': 'Panen dan olah dulu, lalu kembali ke sini.',
  'market.listing': 'dari {who} · sisa {qty}',
  'market.soldout': 'Habis',
  'market.stock': 'Punya {qty} · {price} per buah',
  'market.sell1': 'Jual 1',
  'market.sellAll': 'Jual semua',

  'storage.title': 'Gudang',
  'storage.sub': 'Silo untuk hasil kebun · Lumbung untuk olahan',
  'storage.silo': 'Silo',
  'storage.barn': 'Lumbung',
  'storage.emptySilo': 'Silo masih kosong.',
  'storage.emptyBarn': 'Lumbung masih kosong.',

  'expand.title': 'Perluas Peternakan',
  'expand.sub': 'Pakai koin dan $HAY untuk tumbuh',
  'expand.silo': 'Silo +{n} kapasitas',
  'expand.siloSub': 'Ruang lebih untuk hasil kebun',
  'expand.barn': 'Lumbung +{n} kapasitas',
  'expand.barnSub': 'Ruang lebih untuk olahan',
  'expand.fields': 'Lahan baru di Level {n}',
  'expand.fieldsSub': 'Naik level untuk membuka petak baru',
  'expand.upgrade': 'Tingkatkan',
  'expand.maxed': 'Sudah maksimal',

  'machine.sub': 'Antre sampai {n} pekerjaan',
  'machine.collect': 'Ambil hasil yang siap',
  'machine.make': 'Buat',
  'machine.unlocks': 'Terbuka di Level {n}',
  'pen.sub': 'Beri {feed}, ambil {out}',
  'pen.tend': 'Beri makan & ambil semua',
  'pen.counts': '{ready} siap · {hungry} lapar · {feed} di lumbung: {have}',
  'pen.animals': '{n} {kind}',
  'pen.hint': 'Kamu juga bisa menyentuh hewannya langsung — sentuh gelembung pakan untuk memberi makan, gelembung hasil untuk mengambil.',
  'pen.hens': 'ayam',
  'pen.cows': 'sapi',
  'pen.sheep': 'domba',

  'speedup.button': 'Selesaikan',
  'speedup.cost': 'Selesaikan sekarang: {hay} $HAY',
  'speedup.confirm': 'Selesaikan ini dengan {hay} $HAY?',

  'upgrade.title': 'Peningkatan',
  'upgrade.sub': 'Pakai koin dan $HAY untuk kapasitas permanen',
  'upgrade.slots': '{machine} — {slots} slot kerja',
  'upgrade.slotsSub': 'Satu pekerjaan lagi sekaligus',
  'upgrade.animals': '{pen} — {animals} hewan',
  'upgrade.animalsSub': 'Satu hewan lagi di kandang',
  'upgrade.maxed': 'Sudah penuh',
  'upgrade.buy': 'Beli',
  'upgrade.none.big': 'Belum ada yang bisa ditingkatkan',
  'upgrade.none.sm': 'Slot mesin tambahan terbuka di level {n}.',

  'tasks.title': 'Tugas Harian',
  'tasks.sub': 'Tiga tiap hari. Selesaikan semuanya untuk bonus.',
  'tasks.progress': '{progress} / {target}',
  'tasks.guideMe': 'Pandu aku',
  'tasks.allDone': 'Semua beres hari ini — sampai besok',
  'tasks.bonus': 'Bonus kalau ketiganya selesai',
  'task.plant': 'Tanam {n} benih',
  'task.harvest': 'Panen {n} kali',
  'task.craft': 'Mulai {n} pekerjaan olahan',
  'task.collect_machine': 'Ambil {n} hasil dari mesin',
  'task.feed': 'Beri makan {n} hewan',
  'task.collect_pen': 'Ambil {n} hasil hewan',
  'task.deliver': 'Antar {n} pesanan',
  'task.sell': 'Jual {n} barang di pasar',

  'streak.title': 'Hadiah Harian',
  'streak.day': 'Hari {n}',
  'streak.claim': 'Ambil hari {n}',
  'streak.claimed': 'Kembali lagi besok',
  'streak.sub': 'Main berturut-turut untuk hadiah yang makin besar.',

  'away.title': 'Selagi kamu pergi',
  'away.sub': 'Kamu pergi {time}',
  'away.crops': '{n} tanaman matang',
  'away.goods': '{n} olahan selesai',
  'away.animals': '{n} hewan menghasilkan',
  'away.go': 'Kembali ke peternakan',

  'profile.title': 'Peternakanmu',
  'profile.sub': 'Pemain lain melihat nama ini di papan pesanan mereka',
  'profile.name': 'Namamu',
  'profile.farmName': 'Nama peternakan',
  'profile.namePlaceholder': 'mis. Ayu',
  'profile.farmPlaceholder': 'mis. Sawah Pagi',
  'profile.taken': 'Nama itu sudah dipakai',
  'profile.invalid': 'Pakai 2–20 huruf, angka atau spasi',
  'board.title': 'Peternak Teratas',
  'board.sub': 'Diurutkan berdasarkan level',
  'board.you': 'Kamu',
  'board.rank': '#{n}',
  'board.empty.big': 'Belum ada yang memberi nama',
  'board.empty.sm': 'Pilih nama dan kamu jadi yang pertama.',

  'tutorial.welcome.title': 'Selamat datang di Sunmil',
  'tutorial.welcome.body': 'Aku pandu panen pertamamu. Sekitar satu menit saja.',
  'tutorial.start': 'Pandu aku',
  'tutorial.later': 'Aku sudah paham',
  'tutorial.step': 'Langkah {n} dari {total}',
  'tutorial.done.title': 'Itu seluruh alurnya',
  'tutorial.done.body': 'Tanam, olah, antar, perluas. Sisanya berdiri di atas empat itu.',
  'tutorial.selectSeed': 'Pilih benih dari baki di bawah.',
  'tutorial.plant': 'Sekarang seret melintasi lahanmu untuk menanam. Sekali sapu, semua tertanam.',
  'tutorial.wait': 'Tanaman tumbuh dalam waktu nyata. Bar di atas petak menunjukkan progresnya.',
  'tutorial.speedup': 'Buru-buru? Sentuh tanaman yang sedang tumbuh dan bayar $HAY untuk menyelesaikannya.',
  'tutorial.harvest': 'Sentuh tanaman yang matang untuk memanennya ke silo.',
  'tutorial.machine': 'Sentuh Feed Mill untuk mengubah hasil kebun jadi pakan.',
  'tutorial.queue': 'Pilih resep lalu sentuh Buat.',
  'tutorial.collect': 'Sentuh mesinnya lagi untuk mengambil hasilnya.',
  'tutorial.pen': 'Sentuh kandang, lalu beri makan ayammu.',
  'tutorial.orders': 'Truk butuh barang. Antar satu pesanan untuk koin dan $HAY.',
  'tutorial.tasks': 'Tiga tugas tiap hari. Sentuh satu dan aku pandu sampai selesai.',

  'guide.title': 'Panduan',
  'guide.stop': 'Berhenti memandu',
  'guide.taskDone': 'Tugas selesai — ambil hadiahmu',
  'guide.plant': 'Pilih benih, lalu seret melintasi lahanmu.',
  'guide.harvest': 'Sentuh tanaman yang matang untuk memanen.',
  'guide.craft': 'Buka mesin dan mulai satu pekerjaan.',
  'guide.collect_machine': 'Buka mesin yang hasilnya sudah siap, lalu ambil.',
  'guide.feed': 'Buka kandang dan beri makan hewannya.',
  'guide.collect_pen': 'Ambil hasil dari hewan yang sudah siap.',
  'guide.deliver': 'Buka Pesanan dan antar satu yang bisa kamu penuhi.',
  'guide.sell': 'Buka Pasar, pindah ke tab Jual, lalu jual kelebihanmu.',

  'intro.tagline': 'Tani & Olah',
  'intro.blurb': 'Peternakan rantai produksi di Solana. Tanam, beri makan hewan, jalankan mesin, isi truk.',
  'intro.hint1': '<b>Sapu untuk menanam.</b> Pilih benih di bawah, lalu seret melintasi lahan dalam satu gerakan.',
  'intro.hint2': '<b>Sentuh yang sudah siap.</b> Cahaya keemasan berarti bisa dipanen, diambil, atau diklaim.',
  'intro.hint3': '<b>Peternakanmu tetap jalan</b> selagi kamu pergi — servernya yang memegang jam.',
  'intro.hintFast': '<b>Waktunya dipercepat</b> supaya seluruh alurnya terasa dalam beberapa menit.',
  'intro.hintReal': '<b>Tanaman butuh waktu nyata.</b> Gandum siap sekitar {n} menit.',
  'intro.start': 'Mulai bertani',
  'login.blurb': 'Peternakanmu tinggal di server — tanaman terus tumbuh selagi kamu pergi.',
  'login.wallet': 'Hubungkan dompet',
  'login.play': 'Mulai bertani',
  'login.resume': 'Lanjutkan',
  'login.haveKey': 'Saya sudah punya kunci kebun',
  'login.keyGone': 'Kunci kebun itu sudah tidak membuka kebun mana pun. Mulai yang baru, atau tempel kunci yang benar.',
  'login.noWallet': 'Tidak ada dompet Solana di peramban ini. Pasang Phantom, Solflare, atau Backpack.',
  'login.failed': 'Tidak bisa masuk dengan dompet itu.',
  'login.rejected': 'Kamu menolak tanda tangannya. Tidak ada yang dikirim.',
  'login.pick': 'Dompet yang mana?',
  'login.noAccount': 'Akun {wallet} itu tidak bisa menandatangani untuk SUNMIL. Ganti ke akun Solana lalu coba lagi.',
  'login.pending': 'Dompetmu sudah menunggu — buka dan selesaikan di sana.',
  'login.disconnected': 'Dompetmu terkunci atau di jaringan yang salah.',
  'login.offline': 'Tidak bisa menghubungi server.',
  'rail.mail': 'Kotak Surat',
  'mail.title': 'Kotak Surat',
  'mail.sub': 'Kiriman dari tetangga',
  'mail.from': 'dari {who}',
  'mail.claim': 'Ambil',
  'mail.empty.big': 'Belum ada',
  'mail.empty.sm': 'Kunjungi tetangga dan kirim sesuatu — biasanya dibalas.',
  'visit.at': 'Berkunjung ke {who}',
  'visit.back': 'Kebunku',
  'visit.gift': 'Kirim hadiah',
  'visit.readonly': 'Kamu sedang bertamu — itu ladang mereka, bukan ladangmu.',
  'gift.title': 'Kirim hadiah',
  'gift.sub': 'Dari gudangmu, untuk {who}',
  'gift.send': 'Kirim 3',
  'gift.have': 'punya {n}',
  'gift.sent': 'Terkirim {n} {item}',
  'gift.empty.big': 'Tidak ada yang bisa diberi',
  'gift.empty.sm': 'Panen atau olah dulu sesuatu, lalu kembali ke sini.',
  'board.someone': 'seorang tetangga',
  'push.title': 'Kabari kalau sudah siap?',
  'push.body': 'Kebunmu tetap bekerja selagi kamu pergi. Kami bisa memberitahu begitu ada yang bisa dipanen.',
  'push.yes': 'Ya, kabari',
  'push.no': 'Nanti saja',
  'push.on': 'Nanti kami kabari.',
  'login.retry': 'Coba lagi',
  'login.ourFault': 'Ini masalah di sisi kami, bukan di perangkatmu.',
  'offline.blurb': 'SUNMIL tidak bisa menghubungi server peternakan. Tidak ada yang hilang — kebunmu tersimpan di server dan akan persis seperti kamu tinggalkan.',
  'offline.trying': 'Mencoba…',
  'key.title': 'Simpan kunci kebunmu',
  'key.blurb': 'Kunci ini adalah kebunmu. Kunci disimpan di peramban ini, dan hanya inilah jalan masuk kalau kamu menghapus data atau main di perangkat lain. Tidak ada yang bisa mengirimkannya lagi.',
  'key.copy': 'Salin kunci',
  'key.copied': 'Tersalin',
  'key.copyManually': 'Pilih lalu salin sendiri',
  'key.go': 'Sudah disimpan — main',
  'restore.title': 'Pulihkan kebun',
  'restore.blurb': 'Tempel kunci kebun yang kamu simpan, dan kebunmu kembali persis seperti kamu tinggalkan.',
  'restore.label': 'Kunci kebun',
  'restore.submit': 'Pulihkan',
  'restore.wrong': 'Tidak ada kebun dengan kunci itu.',
  'restore.back': 'Kembali',
  'invite.title': 'Beta tertutup',
  'invite.blurb': 'SUNMIL masih khusus undangan. Masukkan kodemu untuk masuk.',
  'invite.label': 'Kode undangan',
  'invite.submit': 'Masuk',
  'invite.checking': 'Mengecek…',
  'invite.wrong': 'Kodenya salah.',
  'invite.tooMany': 'Terlalu banyak percobaan. Tunggu beberapa menit.',
  'invite.failed': 'Gagal mengecek kode itu.',
  'brand.official': 'Alamat resmi:',
  'brand.officialWarn': 'Hanya hubungkan dompetmu di alamat ini.',

  'notice.planted_partial': 'Koin hanya cukup untuk {n}',
  'notice.silo_nearly_full': 'Silo hampir penuh — jual atau tingkatkan',
  'notice.barn_full': 'Lumbung penuh',
  'notice.order_delivered': 'Diantar ke {who} — +{coins} koin, +{hay} $HAY',
  'notice.sold': 'Terjual {qty}× {item} — +{coins}',
  'notice.expand_done': 'Peningkatan selesai!',
  'notice.sped_up': 'Selesai lebih cepat',
  'notice.machine_slot_added': '{machine} sekarang jalan {jobs} pekerjaan',
  'notice.animal_added': 'Ada penghuni baru di {pen}',
  'notice.task_claimed': 'Tugas selesai — +{coins} koin',
  'notice.tasks_all_done': 'Semua tugas selesai — +{coins} koin dan bonus {hay} $HAY',
  'notice.streak_claimed': 'Hari {day} — +{coins} koin, +{hay} $HAY',
  'notice.profile_saved': 'Tersimpan',
  'notice.hay_withdraw_sent': 'Penarikan dikirim',
  'notice.hay_withdraw_review': 'Penarikan diterima — menunggu ditinjau',
  'notice.hay_withdraw_failed': 'Penarikan gagal — $HAY dikembalikan',
  'notice.hay_deposited': 'Setoran {amount} $HAY masuk',

  'error.network': 'Tidak bisa menghubungi server peternakan.',
  'error.server_error': 'Server peternakan bermasalah.',
  'error.db_unavailable': 'Server peternakan tidak bisa menghubungi basis datanya.',
  'error.db_schema': 'Server peternakan sedang diperbarui. Kebun bisa dibuka lagi setelah selesai.',
  'error.unauthorized': 'Masuk dulu untuk bermain',
  'error.guest_unknown': 'Tidak ada kebun dengan kunci itu',
  'error.forbidden': 'Bukan milikmu',
  'error.not_found': 'Sudah tidak ada',
  'error.rate_limited': 'Pelan-pelan sebentar',
  'error.level_locked': 'Belum terbuka',
  'error.insufficient_coins': 'Koin tidak cukup',
  'error.insufficient_hay': '$HAY tidak cukup',
  'error.missing_items': 'Bahan kurang',
  'error.no_space': 'Gudang tidak muat',
  'error.not_ready': 'Masih diproses',
  'error.queue_full': 'Antrean penuh',
  'error.disabled': 'Belum tersedia',
  'error.conflict': 'Sudah didahului orang lain',
  'error.offline': 'Koneksi ke peternakan terputus',

  'item.wheat': 'Gandum',
  'item.corn': 'Jagung',
  'item.carrot': 'Wortel',
  'item.soybean': 'Kedelai',
  'item.sugarcane': 'Tebu',
  'item.egg': 'Telur',
  'item.milk': 'Susu',
  'item.wool': 'Wol',
  'item.cfeed': 'Pakan Ayam',
  'item.vfeed': 'Pakan Sapi',
  'item.sfeed': 'Pakan Domba',
  'item.bread': 'Roti',
  'item.cake': 'Kue Wortel',
  'item.cream': 'Krim',
  'item.butter': 'Mentega',
  'item.sugar': 'Gula',
  'item.syrup': 'Sirup',
  'item.tomato': 'Tomat',
  'item.strawberry': 'Stroberi',
  'item.pumpkin': 'Labu',
  'item.cheese': 'Keju',
  'item.soup': 'Sup Kebun',
  'item.jam': 'Selai Stroberi',
  'item.pie': 'Pai Labu',
  'machineName.mill': 'Penggilingan Pakan',
  'machineName.bakery': 'Toko Roti',
  'machineName.dairy': 'Rumah Susu',
  'machineName.sugar': 'Penggilingan Gula',
  'machineName.kitchen': 'Dapur',
  'penName.chicken': 'Kandang Ayam',
  'penName.cow': 'Padang Sapi',
  'penName.sheep': 'Kandang Domba',

  'time.s': '{n}d',
  'time.m': '{n}mnt',
  'time.h': '{n}j',
  'time.hm': '{h}j {m}mnt',
};

const DICTS: Record<Lang, Dict> = { en: EN, id: ID };
const STORAGE_KEY = 'sunmil.lang';

export const LANGS: Array<{ code: Lang; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'id', label: 'Bahasa Indonesia' },
];

let current: Lang = 'en';

export function detectLang(): Lang {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'id') return saved;
    const nav = (navigator.language || 'en').toLowerCase();
    if (nav.startsWith('id') || nav.startsWith('in')) return 'id';
  } catch { /* private mode, or no window */ }
  return 'en';
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = DICTS[lang] ? lang : 'en';
  try { window.localStorage.setItem(STORAGE_KEY, current) } catch { /* ignore */ }
  document.documentElement.lang = current;
}

export function initLang(): Lang {
  setLang(detectLang());
  return current;
}

function fill(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : whole
  ));
}

/** Translate a key. Falls back through English to the key itself. */
export function t(key: string, params?: Record<string, string | number>): string {
  const value = DICTS[current][key] ?? EN[key];
  return value == null ? key : fill(value, params);
}

/** Does this key exist in either dictionary? */
export function has(key: string): boolean {
  return DICTS[current][key] != null || EN[key] != null;
}

/**
 * Localised display name for an item, falling back to what the server sent so
 * a newly added item is never blank.
 */
export function itemLabel(id: string, serverName: string): string {
  return DICTS[current][`item.${id}`] ?? serverName;
}

export function machineLabel(id: string, serverName: string): string {
  return DICTS[current][`machineName.${id}`] ?? serverName;
}

export function penLabel(id: string, serverName: string): string {
  return DICTS[current][`penName.${id}`] ?? serverName;
}

/** A duration in the player's language. */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return t('time.s', { n: Math.round(seconds) });
  if (seconds < 3600) return t('time.m', { n: Math.round(seconds / 60) });
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m ? t('time.hm', { h, m }) : t('time.h', { n: h });
}

/** Render a server notice, preferring the localised text for its code. */
export function noticeText(notice: {
  code?: string; message: string; params?: Record<string, string | number>;
}): string {
  if (!notice.code) return notice.message;
  const key = `notice.${notice.code}`;
  if (!has(key)) return notice.message;
  const params = { ...notice.params };
  // Item ids arrive raw so they can be localised here rather than on the server.
  if (typeof params.item === 'string') params.item = t(`item.${params.item}`) || params.item;
  if (typeof params.machine === 'string') params.machine = t(`machineName.${params.machine}`) || params.machine;
  if (typeof params.pen === 'string') params.pen = t(`penName.${params.pen}`) || params.pen;
  return t(key, params as Record<string, string | number>);
}

/** Render a server refusal, preferring the localised text for its code. */
export function errorText(code: string, fallback: string): string {
  const key = `error.${code}`;
  return has(key) ? t(key) : fallback;
}
