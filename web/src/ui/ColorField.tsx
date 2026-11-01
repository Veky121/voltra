import {useEffect,useId,useRef,useState} from 'react';
import {Field} from '../components/ui/field';
import {Label} from '../components/ui/label';
import {Input} from '../components/ui/input';

export function ColorField({label,value,onChange,disabled=false}:{label:string;value:string;onChange:(value:string)=>void;disabled?:boolean}){
  const id=useId(),[text,setText]=useState(value),editing=useRef(false);
  useEffect(()=>{if(!editing.current)setText(value)},[value]);
  function normalize(raw:string){
    const hex=raw.replace(/^#/,'');
    if(/^[\da-f]{6}$/i.test(hex))return '#'+hex.toLowerCase();
    if(/^[\da-f]{3}$/i.test(hex))return '#'+[...hex].map(c=>c+c).join('').toLowerCase();
    return null;
  }
  const invalid=!normalize(text);
  return <Field className="appearance-color-field">
    <Label htmlFor={id}>{label}</Label>
    <div className="appearance-color-inputs">
      <Input type="color" value={value} aria-label={`${label} picker`} disabled={disabled} onChange={e=>{setText(e.target.value);onChange(e.target.value)}}/>
      <Input id={id} value={text} disabled={disabled} spellCheck={false} autoComplete="off" required pattern="#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})" aria-invalid={invalid} aria-describedby={invalid?`${id}-error`:undefined} onFocus={()=>{editing.current=true}} onChange={e=>{setText(e.target.value);const color=normalize(e.target.value);if(color)onChange(color)}} onBlur={()=>{editing.current=false;const color=normalize(text);if(color){setText(color);onChange(color)}}}/>
    </div>
    {invalid&&<span id={`${id}-error`} className="appearance-color-error">Enter a 3- or 6-digit hex color.</span>}
  </Field>;
}
