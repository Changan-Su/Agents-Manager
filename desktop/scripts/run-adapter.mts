import { ClaudeCodeAdapter } from '../electron/scanner/ClaudeCodeAdapter'

async function main() {
  const a = new ClaudeCodeAdapter()
  const det = await a.detect()
  console.log('detect:', JSON.stringify(det))
  if (!det.present) return
  const r = await a.scan(det)
  console.log(
    'counts:',
    JSON.stringify({
      agents: r.agents.length,
      skills: r.skills.length,
      plugins: r.plugins.length,
      commands: r.commands.length,
      hooks: r.hooks.length,
      mcp: r.mcpServers.length,
      settings: r.settings ? 1 : 0,
      errors: r.errors.length,
    }),
  )
  if (r.errors.length) console.log('first 3 errors:', r.errors.slice(0, 3))
  if (r.skills.length)
    console.log('skill[0]:', {
      name: r.skills[0].name,
      desc: r.skills[0].description?.slice(0, 70),
      src: r.skills[0].sourcePath,
    })
  if (r.agents.length)
    console.log('agent[0]:', {
      name: r.agents[0].name,
      model: r.agents[0].model,
      tools: r.agents[0].tools?.slice(0, 3),
    })
  if (r.mcpServers.length)
    console.log('mcp[0..2]:', r.mcpServers.slice(0, 3).map((m) => ({
      name: m.name,
      type: m.type,
      command: m.command,
    })))
  if (r.plugins.length)
    console.log('plugin[0]:', { name: r.plugins[0].name, src: r.plugins[0].sourcePath })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
