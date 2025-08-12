const makeWASocket = require('@whiskeysockets/baileys').default
const { useMultiFileAuthState } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const fs = require('fs')

const sessionFolder = 'session'
const bossFile = 'boss.json'
let bosses = []
let activeGroups = new Set()

function loadBosses() {
  if (!fs.existsSync(bossFile)) return []
  return JSON.parse(fs.readFileSync(bossFile))
}

function saveBosses(bosses) {
  fs.writeFileSync(bossFile, JSON.stringify(bosses, null, 2))
}

function formatTime(ms) {
  if (ms < 0) return '0s'
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${h}h ${m}m ${s}s`
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder)
  const sock = makeWASocket({ auth: state, printQRInTerminal: false })

  sock.ev.on('connection.update', ({ connection, qr }) => {
    if (qr) {
      console.log('Scan this QR code to login:')
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'open') console.log('✅ Bot aktif dan terhubung ke WhatsApp')
    if (connection === 'close') console.log('❌ Koneksi terputus, coba scan ulang QR kalau perlu')
  })

  sock.ev.on('creds.update', saveCreds)

  bosses = loadBosses()

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    if (!m.message || !m.key.remoteJid) return
    const from = m.key.remoteJid
    const isGroup = from.endsWith('@g.us')

    // Catat grup aktif yang bot ikut supaya nanti bisa dikirimi notif spawn boss
    if (isGroup) {
      activeGroups.add(from)
      // console.log(`Bot aktif di grup: ${from}`)
    }

    const text = m.message.conversation || m.message.extendedTextMessage?.text
    if (!text) return

    const args = text.trim().split(' ')
    const cmd = args[0].toLowerCase()

    // Batasi command hanya di grup atau chat personal (boleh semua)
    // Kalau mau batasi, bisa tambah cek isGroup

    if (cmd === '!addboss') {
      const name = args[1]
      const hours = parseFloat(args[2])
      const location = args.slice(3).join(' ') || '-'
      if (!name || isNaN(hours)) {
        await sock.sendMessage(from, { text: '❌ Format: !addboss NamaBoss IntervalJam LokasiBoss' })
        return
      }
      bosses.push({
        name,
        spawnInterval: hours * 3600000,
        nextSpawn: Date.now() + hours * 3600000,
        location,
        killed: false
      })
      saveBosses(bosses)
      await sock.sendMessage(from, { text: `✅ Boss ${name} ditambahkan dengan spawn setiap ${hours} jam di lokasi "${location}"` })
    }

    else if (cmd === '!delboss') {
      const name = args[1]
      const beforeLen = bosses.length
      bosses = bosses.filter(b => b.name.toLowerCase() !== name.toLowerCase())
      if (bosses.length === beforeLen) {
        await sock.sendMessage(from, { text: `❌ Boss ${name} tidak ditemukan` })
        return
      }
      saveBosses(bosses)
      await sock.sendMessage(from, { text: `🗑 Boss ${name} dihapus` })
    }

    else if (cmd === '!listboss') {
      if (bosses.length === 0) {
        await sock.sendMessage(from, { text: '📭 Belum ada boss terdaftar' })
        return
      }
      let msg = '📜 Daftar Boss:\n'
      bosses.forEach(b => {
        const timeLeft = formatTime(b.nextSpawn - Date.now())
        const status = b.killed ? ' (Sudah terkill)' : ''
        msg += `- ${b.name} | Spawn dalam ${timeLeft} | Lokasi: ${b.location}${status}\n`
      })
      await sock.sendMessage(from, { text: msg })
    }

    else if (cmd === '!setspawn') {
      const name = args[1]
      const minutes = parseInt(args[2])
      if (!name || isNaN(minutes)) {
        await sock.sendMessage(from, { text: '❌ Format: !setspawn NamaBoss Menit' })
        return
      }
      const boss = bosses.find(b => b.name.toLowerCase() === name.toLowerCase())
      if (!boss) {
        await sock.sendMessage(from, { text: `❌ Boss ${name} tidak ditemukan` })
        return
      }
      boss.nextSpawn = Date.now() + minutes * 60000
      boss.killed = false
      saveBosses(bosses)
      await sock.sendMessage(from, { text: `✅ Spawn ${name} diatur ${minutes} menit dari sekarang` })
    }

    else if (cmd === '!killboss') {
      const name = args[1]
      if (!name) {
        await sock.sendMessage(from, { text: '❌ Format: !killboss NamaBoss' })
        return
      }
      const boss = bosses.find(b => b.name.toLowerCase() === name.toLowerCase())
      if (!boss) {
        await sock.sendMessage(from, { text: `❌ Boss ${name} tidak ditemukan` })
        return
      }
      boss.killed = true
      saveBosses(bosses)
      await sock.sendMessage(from, { text: `⚔️ Boss ${name} telah terkill!` })
    }
  })

  // Kirim notif spawn boss ke semua grup aktif
  setInterval(async () => {
    const now = Date.now()
    for (const boss of bosses) {
      if (!boss.killed && now >= boss.nextSpawn) {
        for (const group of activeGroups) {
          await sock.sendMessage(group, { text: `⚡ *${boss.name}* sudah spawn di lokasi ${boss.location}!` })
        }
        boss.nextSpawn = now + boss.spawnInterval
        saveBosses(bosses)
      } else if (!boss.killed && boss.nextSpawn - now <= 5 * 60 * 1000 && boss.nextSpawn - now > 0) {
        for (const group of activeGroups) {
          await sock.sendMessage(group, { text: `⏳ *${boss.name}* spawn dalam ${formatTime(boss.nextSpawn - now)} di lokasi ${boss.location}` })
        }
      }
    }
  }, 60 * 1000)
}

startBot()
