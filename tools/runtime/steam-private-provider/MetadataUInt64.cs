// MIT. Lossless public JSON ABI; internal identities remain typed uint64.
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Voltra.SteamPrivate;

[JsonConverter(typeof(MetadataUInt64Converter))]
internal readonly record struct MetadataUInt64(ulong Value)
{
    public static implicit operator MetadataUInt64(ulong value) => new(value);
    public static ulong? ParseCanonical(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 20 || value.Length > 1 && value[0] == '0'
            || value.Any(c => c is < '0' or > '9')) return null;
        return ulong.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var number) ? number : null;
    }
    public override string ToString() => Value.ToString(CultureInfo.InvariantCulture);
}

internal sealed class MetadataUInt64Converter : JsonConverter<MetadataUInt64>
{
    public override MetadataUInt64 Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.String) throw new JsonException("invalid_metadata_identity");
        var number = MetadataUInt64.ParseCanonical(reader.GetString());
        return number is null ? throw new JsonException("invalid_metadata_identity") : new(number.Value);
    }
    public override void Write(Utf8JsonWriter writer, MetadataUInt64 value, JsonSerializerOptions options)
        => writer.WriteStringValue(value.Value.ToString(CultureInfo.InvariantCulture));
}
