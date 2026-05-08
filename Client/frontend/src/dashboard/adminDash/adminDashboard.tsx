export function AdminComponent() {
    const cards = [
        { title: 'Active Agents', value: '128', trend: '+12%' },
        { title: 'Queued Commands', value: '34', trend: '+4%' },
        { title: 'Beacon Health', value: '99.2%', trend: '+0.3%' },
        { title: 'Alerts', value: '2', trend: '-40%' },
    ]

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-2xl font-semibold text-slate-100">Dashboard Overview</h3>
                <p className="text-sm text-slate-400">Real-time visibility into command and control operations.</p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {cards.map((card) => (
                    <article key={card.title} className="panel p-4">
                        <p className="text-sm text-slate-400">{card.title}</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-100">{card.value}</p>
                        <p className="mt-1 text-xs text-emerald-400">{card.trend} in the last hour</p>
                    </article>
                ))}
            </div>

            <div className="panel overflow-hidden">
                <div className="border-b border-slate-800 px-4 py-3">
                    <h4 className="text-sm font-semibold text-slate-100">Recent Command Activity</h4>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                        <thead className="bg-slate-900/80 text-slate-400">
                            <tr>
                                <th className="px-4 py-3 font-medium">Agent</th>
                                <th className="px-4 py-3 font-medium">Command</th>
                                <th className="px-4 py-3 font-medium">Status</th>
                                <th className="px-4 py-3 font-medium">Last Seen</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 text-slate-200">
                            <tr>
                                <td className="px-4 py-3">NODE-03</td>
                                <td className="px-4 py-3">collect-system-info</td>
                                <td className="px-4 py-3 text-emerald-400">Completed</td>
                                <td className="px-4 py-3 text-slate-400">12s ago</td>
                            </tr>
                            <tr>
                                <td className="px-4 py-3">EDGE-11</td>
                                <td className="px-4 py-3">download-logs</td>
                                <td className="px-4 py-3 text-amber-400">Running</td>
                                <td className="px-4 py-3 text-slate-400">48s ago</td>
                            </tr>
                            <tr>
                                <td className="px-4 py-3">DC-02</td>
                                <td className="px-4 py-3">screen-capture</td>
                                <td className="px-4 py-3 text-sky-400">Queued</td>
                                <td className="px-4 py-3 text-slate-400">2m ago</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}