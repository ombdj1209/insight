/** Which meeting app owns a Windows microphone ConsentStore key (null for Insight itself or non-meeting apps). */
const APPS: [RegExp, string][] = [
  [/zoom/i, 'Zoom'],
  [/ms-?teams|teams\.exe|MSTeams/i, 'Microsoft Teams'],
  [/webex|CiscoCollabHost|atmgr/i, 'Webex'],
  [/slack/i, 'Slack'],
  [/discord/i, 'Discord'],
  [/skype|lync/i, 'Skype'],
  [/whatsapp/i, 'WhatsApp'],
  [/telegram/i, 'Telegram'],
  [/gotomeeting|g2mcomm/i, 'GoTo Meeting'],
  [/chrome\.exe|msedge\.exe|firefox\.exe|brave\.exe|opera\.exe|vivaldi\.exe|arc\.exe/i, 'your browser']
]
const OWN = /electron\.exe|insight\.exe/i

export function callAppName(key: string): string | null {
  const exe = key.split('#').pop() ?? key
  if (OWN.test(exe)) return null
  for (const [re, name] of APPS) if (re.test(exe) || re.test(key)) return name
  return null
}
