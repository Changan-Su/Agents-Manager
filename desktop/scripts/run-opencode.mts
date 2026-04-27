import { OpenCodeAdapter } from '../electron/scanner/OpenCodeAdapter'

async function main() {
  const a = new OpenCodeAdapter()
  const det = await a.detect()
  console.log('detect:', JSON.stringify(det))
  if (!det.present) return
  const r = await a.scan(det)
  console.log('counts:', JSON.stringify({
    agents: r.agents.length,
    skills: r.skills.length,
    plugins: r.plugins.length,
    commands: r.commands.length,
    hooks: r.hooks.length,
    mcp: r.mcpServers.length,
    settings: r.settings ? 1 : 0,
    errors: r.errors.length,
  }))
  if (r.errors.length) console.log('errors:', r.errors.slice(0, 3))
  if (r.agents[0]) console.log('agent[0]:', { name: r.agents[0].name, model: r.agents[0].model, mode: r.agents[0].mode, tools: r.agents[0].tools })
  if (r.commands[0]) console.log('cmd[0]:', { name: r.commands[0].name, desc: r.commands[0].description })
  if (r.skills[0]) console.log('skill[0]:', { name: r.skills[0].name, src: r.skills[0].sourcePath })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
