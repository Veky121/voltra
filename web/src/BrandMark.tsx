import './brand.css';

/** One identity shared by the browser panel, setup and native desktop client. */
export default function BrandMark(){
  return <img className="brand-mark brand-image" src="/brand/voltra-128.png" srcSet="/brand/voltra-64.png 1x, /brand/voltra-128.png 2x" width={32} height={32} alt="" aria-hidden="true" draggable={false}/>;
}
