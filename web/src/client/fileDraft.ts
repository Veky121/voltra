export type FileDraft={path:string;content:string;saved:string;revision:number};
export function loadedDraft(path:string,content:string):FileDraft{return {path,content,saved:content,revision:0}}
export function isDraftDirty(draft:FileDraft){return draft.content!==draft.saved}
export function commitDraft(draft:FileDraft,path:string,saved:string):FileDraft{
  // A save may finish after more typing or after a different file has been loaded.
  return draft.path===path?{...draft,saved}:draft;
}
export function discardDraft(draft:FileDraft):FileDraft{return {...draft,content:draft.saved,revision:draft.revision+1}}
