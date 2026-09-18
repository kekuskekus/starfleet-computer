export function installComputerSceneControl(controls, control) {
  if (!controls || !control?.name) return false;

  if (Array.isArray(controls)) {
    if (!controls.some(entry => entry.name === control.name)) controls.push(control);
    return true;
  }

  if (!controls[control.name]) {
    controls[control.name] = {
      ...control,
      order: Object.keys(controls).length
    };
  }
  return true;
}
