import { useState } from 'react'
import { FieldLabel, Input } from '../../UI'

export default function SettingsPage() {
  const [serverUrl, setServerUrl] = useState('ws://localhost:8080/ws')
  const [apiHost, setApiHost] = useState('http://localhost:8080')
  const [authToken, setAuthToken] = useState('')

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-2xl font-semibold text-slate-100">Settings</h3>
        <p className="text-sm text-slate-400">Configure C2 server connection settings.</p>
      </div>

      <section className="panel p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <FieldLabel label="WebSocket URL">
            <Input
              type="text"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="ws://host:port/ws"
            />
          </FieldLabel>

          <FieldLabel label="API Base URL">
            <Input
              type="text"
              value={apiHost}
              onChange={(event) => setApiHost(event.target.value)}
              placeholder="http://host:port"
            />
          </FieldLabel>

          <FieldLabel label="Auth Token" className="md:col-span-2">
            <Input
              type="password"
              value={authToken}
              onChange={(event) => setAuthToken(event.target.value)}
              placeholder="Enter access token"
            />
          </FieldLabel>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
          >
            Reset
          </button>
          <button
            type="button"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500"
          >
            Save Config
          </button>
        </div>
      </section>
    </div>
  )
}
