export function ensureRuntimeUpdateControl(egg) {
  if (egg.variables.some(variable => variable.env_variable === 'AUTO_UPDATE')) return;
  egg.variables.push({name:'Automatic updates',description:'Update the dedicated server before startup. Disable to retain the installed publisher build.',env_variable:'AUTO_UPDATE',default_value:'1',user_viewable:true,user_editable:true,rules:'required|boolean',field_type:'text'});
}
