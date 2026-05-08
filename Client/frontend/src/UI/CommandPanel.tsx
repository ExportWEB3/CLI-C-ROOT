import { useMemo, useState } from 'react'
import { Heading, Input, SectionTitle, Select, Button } from './index'

const commonCommands = [
  'exec',
  'screenshot',
  'process_list',
  'keylog_start',
  'keylog_stop',
  'persistence_on',
  'persistence_off',
  'show_update',
  'hide_update',
] as const

export interface CommandPanelProps {
  onSendCommand: (command: string) => void | Promise<void>
  output: string
}

export default function CommandPanel({ onSendCommand, output }: CommandPanelProps) {
  const [selectedCommand, setSelectedCommand] = useState<string>(commonCommands[0])
  const [customCommand, setCustomCommand] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const commandToSend = useMemo(() => {
    const trimmedCustom = customCommand.trim()
    return trimmedCustom.length > 0 ? trimmedCustom : selectedCommand
  }, [customCommand, selectedCommand])

  const runCommand = async (command: string) => {
    const trimmed = command.trim()
    if (!trimmed) return

    setIsLoading(true)
    try {
      await onSendCommand(trimmed)
      // Add a small visual delay so the user sees the spinner and knows the action registered
      await new Promise((resolve) => setTimeout(resolve, 400))
    } finally {
      setIsLoading(false)
    }

    setHistory((previous) => {
      const deduped = previous.filter((item) => item !== trimmed)
      return [trimmed, ...deduped].slice(0, 20)
    })
  }

  const handleSend = async () => {
    await runCommand(commandToSend)
  }

  const handleHistoryClick = async (command: string) => {
    setCustomCommand(command)
    await runCommand(command)
  }

  return (
    <section className="panel min-w-0 p-4">
      <div className="mb-4 flex items-center justify-between">
        <Heading>Command Panel</Heading>
      </div>

      <div className="grid min-w-0 gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto]">
        <Select
          value={selectedCommand}
          onChange={(event) => setSelectedCommand(event.target.value)}
        >
          {commonCommands.map((command) => (
            <option key={command} value={command}>
              {command}
            </option>
          ))}
        </Select>

        <Input
          type="text"
          value={customCommand}
          onChange={(event) => setCustomCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void handleSend()
            }
          }}
          placeholder="Custom command (overrides dropdown)"
        />

        <Button
          type="button"
          onClick={() => {
            void handleSend()
          }}
          disabled={!commandToSend.trim()}
          isLoading={isLoading}
          variant="primary"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500"
        >
          Send
        </Button>
      </div>

      <div className="mt-4">
        <SectionTitle className="mb-2">Command History</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {history.length === 0 ? (
            <span className="text-sm text-slate-500">No commands sent yet.</span>
          ) : (
            history.map((command) => (
              <Button
                key={command}
                type="button"
                onClick={() => {
                  void handleHistoryClick(command)
                }}
                disabled={isLoading}
                variant="ghost"
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 transition hover:border-brand-500 hover:text-white"
                title="Click to re-run"
              >
                {command}
              </Button>
            ))
          )}
        </div>
      </div>

      <div className="mt-4">
        <SectionTitle className="mb-2">Output</SectionTitle>
        <pre className="max-h-64 min-w-0 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-800 bg-slate-950/70 p-3 font-mono text-xs leading-relaxed text-slate-200">
          {output?.trim() ? output : 'No output yet.'}
        </pre>
      </div>
    </section>
  )
}
