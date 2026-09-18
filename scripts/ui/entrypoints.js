export function installComputerSceneControl(controls, tool) {
  const tokenGroup = Array.isArray(controls)
    ? controls.find(control => control?.name === "tokens" || control?.name === "token")
    : controls?.tokens ?? controls?.token;
  if (!tokenGroup?.tools) return false;

  if (Array.isArray(tokenGroup.tools)) {
    if (!tokenGroup.tools.some(entry => entry.name === tool.name)) tokenGroup.tools.push(tool);
    return true;
  }

  if (!tokenGroup.tools[tool.name]) {
    tokenGroup.tools[tool.name] = {
      ...tool,
      order: Object.keys(tokenGroup.tools).length
    };
  }
  return true;
}
