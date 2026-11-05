using System;
using System.IO;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text.Json;
// Read metadata only. No loading or invocation of publisher assemblies.
foreach (string file in args) {
 using var stream=File.OpenRead(file);using var pe=new PEReader(stream);var reader=pe.GetMetadataReader();
 foreach(var handle in reader.TypeDefinitions) {
  var type=reader.GetTypeDefinition(handle);
  if(reader.GetString(type.Namespace)!="Terraria"||reader.GetString(type.Name)!="Main")continue;
  foreach(var fieldHandle in type.GetFields()) {
   var field=reader.GetFieldDefinition(fieldHandle);string name=reader.GetString(field.Name);
   if(!name.Contains("release",StringComparison.OrdinalIgnoreCase)&&!name.Contains("version",StringComparison.OrdinalIgnoreCase))continue;
   var constantHandle=field.GetDefaultValue();if(constantHandle.IsNil)continue;
   var constant=reader.GetConstant(constantHandle);var blob=reader.GetBlobReader(constant.Value);
   object? value=constant.TypeCode switch {ConstantTypeCode.Int32=>blob.ReadInt32(),ConstantTypeCode.String=>blob.ReadUTF16(blob.Length),_=>null};
   Console.WriteLine(JsonSerializer.Serialize(new {file=Path.GetFileName(file),type="Terraria.Main",field=name,value}));
  }
 }
}
