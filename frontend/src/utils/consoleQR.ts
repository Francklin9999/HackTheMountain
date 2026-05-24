import QRCode from 'qrcode'

export async function printQRToConsole(url: string) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' })
  const { data, size } = qr.modules

  const MARGIN = 2
  const total = size + MARGIN * 2

  const get = (r: number, c: number): boolean => {
    const qr_r = r - MARGIN
    const qr_c = c - MARGIN
    if (qr_r < 0 || qr_r >= size || qr_c < 0 || qr_c >= size) return false
    return !!data[qr_r * size + qr_c]
  }

  const lines: string[] = []
  for (let r = 0; r < total; r += 2) {
    let line = ''
    for (let c = 0; c < total; c++) {
      const top = get(r, c)
      const bot = get(r + 1, c)
      if (top && bot) line += '█'
      else if (top)   line += '▀'
      else if (bot)   line += '▄'
      else             line += ' '
    }
    lines.push(line)
  }

  const style = 'color:#00BD7D;font-family:monospace;font-size:7px;line-height:1.1'
  console.log('%c▶  SILLON  ·  scan to open on mobile', 'color:#00BD7D;font-family:monospace;font-weight:bold;font-size:12px')
  console.log('%c' + lines.join('\n'), style)
  console.log('%c  ' + url, 'color:#00BD7D;font-family:monospace;font-size:11px')
}
