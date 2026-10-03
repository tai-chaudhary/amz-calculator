const fs=require('fs'),dir='src/components/';
function params(s){const i=s.indexOf('(');if(i<0)return '';let d=0;for(let j=i;j<s.length;j++){if(s[j]==='(')d++;else if(s[j]===')'){d--;if(!d)return s.slice(i,j+1)}}return ''}
let bad=0;
for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('.jsx'))){
 const src=fs.readFileSync(dir+f,'utf8');
 for(const p of src.split(/\n(?=(?:export default )?function )/)){
  const sig=params(p),body=p.slice(p.indexOf(sig)+sig.length);
  for(const v of ['me','profiles','onSaveProfile','focusId','onNavigate','stockItems']){
   const re=new RegExp('(?<![.\\w"\'])'+v+'\\b');
   const declared=new RegExp('(const|let|function)\\s+[^=\\n]*\\b'+v+'\\b[^=\\n]*[=(]').test(body);
   if(re.test(body)&&!re.test(sig)&&!declared){
    console.log('ORPHAN',f,'::',p.split('\n')[0].slice(0,52),'->',v);bad++}}}}
console.log(bad?bad+' issue(s)':'✓ clean');
