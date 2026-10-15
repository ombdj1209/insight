/** Google Workspace MCP servers (developers.google.com/workspace/guides/configure-mcp-servers). Read-only scopes only. */
export const GOOGLE_SERVICES = {
  gmail: {
    label: 'Gmail',
    url: 'https://gmailmcp.googleapis.com/mcp/v1',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly']
  },
  calendar: {
    label: 'Calendar',
    url: 'https://calendarmcp.googleapis.com/mcp/v1',
    scopes: [
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.events.freebusy',
      'https://www.googleapis.com/auth/calendar.events.readonly'
    ]
  },
  chat: {
    label: 'Chat',
    url: 'https://chatmcp.googleapis.com/mcp/v1',
    scopes: [
      'https://www.googleapis.com/auth/chat.spaces.readonly',
      'https://www.googleapis.com/auth/chat.memberships.readonly',
      'https://www.googleapis.com/auth/chat.messages.readonly'
    ]
  },
  drive: {
    label: 'Drive',
    url: 'https://drivemcp.googleapis.com/mcp/v1',
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  },
  people: {
    label: 'Contacts',
    url: 'https://people.googleapis.com/mcp/v1',
    scopes: ['https://www.googleapis.com/auth/contacts.readonly', 'https://www.googleapis.com/auth/directory.readonly', 'https://www.googleapis.com/auth/userinfo.profile']
  }
} as const

export type GoogleService = keyof typeof GOOGLE_SERVICES
export const GOOGLE_SERVICE_IDS = Object.keys(GOOGLE_SERVICES) as GoogleService[]

/** Register this exact URI as an authorised redirect URI on the OAuth client (type: Web application). */
export const OAUTH_PORT = 47820
export const OAUTH_REDIRECT = `http://127.0.0.1:${OAUTH_PORT}/oauth/callback`

export interface GoogleStatus {
  clientConfigured: boolean
  connected: boolean
  email?: string
  /** Services enabled in settings whose scopes were not granted at sign-in; reconnect to add them. */
  missingScopes: GoogleService[]
  actionsNeedReconnect?: boolean
  services: { id: GoogleService; tools?: number; error?: string }[]
}

export interface CalEvent {
  id: string
  title: string
  start: number
  end: number
  allDay: boolean
  location?: string
  joinUrl?: string
  htmlLink?: string
  attendees: number
  people?: Person[]
  description?: string
}

export interface Person {
  email: string
  name?: string
  self?: boolean
}

/** Write scopes, only requested when the user turns on "Allow actions". Every write also needs a confirm click in the app. */
export const ACTION_SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose', // create drafts (never sends)
  'https://www.googleapis.com/auth/tasks', // add action items to Google Tasks
  'https://www.googleapis.com/auth/calendar.events' // book a follow-up meeting
]

const MEETING_URL = /https:\/\/[^\s"'<>]*(?:zoom\.us\/(?:j|my|w)\/|teams\.microsoft\.com\/l\/meetup-join|teams\.live\.com\/meet|meet\.google\.com\/|webex\.com\/|whereby\.com\/)[^\s"'<>]*/i

/** Video-call link of a Google Calendar event: Meet conference data, else a Zoom/Teams/Meet/Webex URL in the location or description. */
export function joinUrlOf(e: {
  hangoutLink?: string
  location?: string
  description?: string
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
}): string | undefined {
  return (
    e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ||
    e.hangoutLink ||
    `${e.location ?? ''} ${e.description ?? ''}`.match(MEETING_URL)?.[0]?.replace(/&amp;/g, '&')
  )
}
