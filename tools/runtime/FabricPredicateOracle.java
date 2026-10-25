import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import net.fabricmc.loader.api.Version;
import net.fabricmc.loader.api.metadata.version.VersionPredicate;
public class FabricPredicateOracle {
 public static void main(String[] args) throws Exception {
  var reader=new BufferedReader(new InputStreamReader(System.in,StandardCharsets.UTF_8));String line;
  while((line=reader.readLine())!=null){String[] columns=line.split("\\t",-1);try{Version version=Version.parse(new String(Base64.getDecoder().decode(columns[0]),StandardCharsets.UTF_8));boolean matches=false;
   for(int i=1;i<columns.length;i++){var p=VersionPredicate.parse(new String(Base64.getDecoder().decode(columns[i]),StandardCharsets.UTF_8));if(p.test(version))matches=true;}
   System.out.println(matches?"true":"false");
  }catch(Exception ex){System.out.println("error");}}
 }
}
