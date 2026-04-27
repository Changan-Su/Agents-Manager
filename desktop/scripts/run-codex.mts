import { CodexAdapter } from '../electron/scanner/CodexAdapter'
const a = new CodexAdapter()
const det = await a.detect()
console.log('detect:', JSON.stringify(det))
if (det.present) {
  const r = await a.scan(det)
  console.log('counts:', JSON.stringify({
    agents: r.agents.length, skills: r.skills.length, plugins: r.plugins.length,
    commands: r.commands.length, hooks: r.hooks.length, mcp: r.mcpServers.length,
    settings: r.settings ? 1 : 0, errors: r.errors.length,
  }))
  if (r.errors.length) console.log('errors:', r.errors.slice(0, 3))
  if (r.agents[0]) console.log('agent[0]:', { name: r.agents[0].name, model: r.agents[0].model, desc: r.agents[0].description?.slice(0,60) })
  if (r.mcpServers[0]) console.log('mcp[0]:', r.mcpServers[0])
  if (r.plugins[0]) console.log('plugin[0]:', { name: r.plugins[0].name, desc: r.plugins[0].description })
}
