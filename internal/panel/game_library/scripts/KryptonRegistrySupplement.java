// SPDX-License-Identifier: MIT
// Voltra registry compatibility generator. Never invokes Minecraft Main or creates worlds.
import com.google.gson.*;
import java.nio.file.*;
import java.lang.reflect.*;
import java.util.*;
import java.net.*;
public final class KryptonRegistrySupplement {
 static JsonObject spec;
 static Class<?> cls(String n)throws Exception{return Class.forName(spec.getAsJsonObject(n).get("class").getAsString());}
 static String member(String c,String n){return spec.getAsJsonObject(c).get(n).getAsString();}
 static Object call(String c,String n,Object o)throws Exception{Method m=cls(c).getDeclaredMethod(member(c,n));m.setAccessible(true);return m.invoke(o);}
 static Field field(String c,String n)throws Exception{Field f=cls(c).getDeclaredField(member(c,n));f.setAccessible(true);return f;}
 static IdentityHashMap<Object,String> names(String c)throws Exception{
  IdentityHashMap<Object,String> result=new IdentityHashMap<>();
  for(var e:spec.getAsJsonObject(c).entrySet())if(!e.getKey().equals("class")){
   Field f=cls(c).getDeclaredField(e.getValue().getAsString());f.setAccessible(true);
   if(Modifier.isStatic(f.getModifiers())&&f.getType()==cls(c)){
    Object v=f.get(null);String old=result.put(v,e.getKey());if(old!=null)throw new IllegalStateException("Ambiguous symbolic identity "+c+" "+old+" / "+e.getKey());
   }
  }return result;
 }
 public static void main(String[] args)throws Exception{
  spec=JsonParser.parseString(Files.readString(Path.of(args[0]))).getAsJsonObject();
  call("SharedConstants","tryDetectVersion",null);call("Bootstrap","bootStrap",null);
  var materials=names("Material");var sounds=names("SoundType");
  Map<String,String> exactProperties=new HashMap<>();
  for(var e:JsonParser.parseString(Files.readString(Path.of(args[3]))).getAsJsonObject().entrySet()){
   JsonObject p=e.getValue().getAsJsonObject();List<String> strings=new ArrayList<>();for(JsonElement v:p.getAsJsonArray("values"))strings.add(v.getAsString());Collections.sort(strings);
   String signature=p.get("name").getAsString()+":"+strings;
   if(exactProperties.put(signature,e.getKey())!=null)throw new IllegalStateException("Ambiguous Krypton property signature "+signature);
  }
  JsonObject blocks=JsonParser.parseString(Files.readString(Path.of(args[1]))).getAsJsonObject();
  Object registry=field("Block","BLOCK_STATE_REGISTRY").get(null);
  Method id=cls("IdMapper").getDeclaredMethod(member("IdMapper","getId"),Object.class);
  int count=0;
  for(var e:blocks.entrySet()){
   JsonObject row=e.getValue().getAsJsonObject();Object block=field("Blocks",row.get("mojangName").getAsString()).get(null);
   Object state=call("Block","defaultBlockState",block);
   if(((Integer)id.invoke(registry,state))!=row.get("defaultStateId").getAsInt())throw new IllegalStateException("Default state mismatch "+e.getKey());
   String material=materials.get(call("BlockStateBase","getMaterial",state));String sound=sounds.get(call("BlockStateBase","getSoundType",state));
   if(material==null||sound==null)throw new IllegalStateException("Unknown material/sound identity "+e.getKey());
   row.addProperty("material",material);row.addProperty("soundType",sound);
   row.addProperty("collision",field("BlockBehaviour","hasCollision").getBoolean(block));
   row.addProperty("hardness",(Float)call("BlockBehaviour","defaultDestroyTime",block));
   row.addProperty("requiresCorrectTool",(Boolean)call("BlockStateBase","requiresCorrectToolForDrops",state));
   row.addProperty("drops",call("BlockBehaviour","getLootTable",block).toString());
   row.addProperty("canOcclude",(Boolean)call("BlockStateBase","canOcclude",state));
   row.addProperty("air",(Boolean)call("BlockStateBase","isAir",state));count++;
   JsonArray properties=new JsonArray();
   for(JsonElement name:row.getAsJsonArray("properties")){
    Object prop=field("StateProperties",name.getAsString()).get(null);
    Collection<?> values=(Collection<?>)call("Property","getPossibleValues",prop);List<String> strings=new ArrayList<>();
    Method serial=cls("Property").getDeclaredMethod(member("Property","getNameValue"),Comparable.class);
    for(Object v:values)strings.add((String)serial.invoke(prop,v));Collections.sort(strings);
    String signature=call("Property","getName",prop)+":"+strings;
    String matched=exactProperties.get(signature);if(matched==null)throw new IllegalStateException("No exact Krypton property signature "+signature);
    properties.add(matched);
   }row.add("properties",properties);
  }
  Files.writeString(Path.of(args[2]),new Gson().toJson(blocks));System.out.println("Exact block registry supplement rows="+count);
 }
}
