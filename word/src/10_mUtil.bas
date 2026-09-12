Attribute VB_Name = "mUtil"
Option Explicit

' ================= строковые утилиты =================

Public Function TrimS(ByVal s As String) As String
    s = Replace(s, vbCr, " ")
    s = Replace(s, vbLf, " ")
    s = Replace(s, vbTab, " ")
    s = Replace(s, vbVerticalTab, " ")
    TrimS = Trim$(s)
End Function

Public Function NormSp(ByVal s As String) As String
    Dim r As String, p As String
    r = TrimS(s)
    Do
        p = r
        r = Replace(r, "  ", " ")
    Loop Until r = p
    NormSp = r
End Function

Public Function StartsWith(ByVal s As String, ByVal p As String) As Boolean
    If Len(s) < Len(p) Then Exit Function
    StartsWith = (LCase$(Left$(s, Len(p))) = LCase$(p))
End Function

' разделитель — строка любой длины; возвращает Variant() строк
Public Function SplitParts(ByVal s As String, ByVal d As String) As Variant
    Dim out() As Variant, n As Long, i As Long
    ReDim out(0 To 15)
    n = 0
    If Len(d) = 0 Then
        out(0) = s
        SplitParts = out
        Exit Function
    End If
    Do
        i = InStr(s, d)
        If i = 0 Then Exit Do
        If n > UBound(out) Then ReDim Preserve out(0 To n * 2)
        out(n) = Left$(s, i - 1)
        n = n + 1
        s = Mid$(s, i + Len(d))
    Loop
    If n > UBound(out) Then ReDim Preserve out(0 To n)
    out(n) = s
    ReDim Preserve out(0 To n)
    SplitParts = out
End Function

Public Function Pad2(ByVal n As Long) As String
    Pad2 = Right$("0" & CStr(n), 2)
End Function

Public Function IsDigitCh(ByVal c As String) As Boolean
    IsDigitCh = (c >= "0" And c <= "9")
End Function

' первое число, идущее в строке после произвольного текста; 0, если нет
Public Function FirstNum(ByVal s As String) As Long
    Dim i As Long, r As String
    For i = 1 To Len(s)
        If IsDigitCh(Mid$(s, i, 1)) Then
            r = r & Mid$(s, i, 1)
        ElseIf Len(r) > 0 Then
            Exit For
        End If
    Next i
    If Len(r) > 0 Then FirstNum = CLng(r)
End Function

' ================= таймкоды (NDF) =================

Public Function IsTc(ByVal s As String) As Boolean
    Dim i As Long, c As String
    s = Trim$(s)
    If Len(s) <> 11 Then Exit Function
    For i = 1 To 11
        c = Mid$(s, i, 1)
        Select Case i
            Case 3, 6, 9
                If c <> ":" Then Exit Function
            Case Else
                If Not IsDigitCh(c) Then Exit Function
        End Select
    Next i
    IsTc = True
End Function

' TC -> кадры; fb — целое число кадров в «секунде» таймкода (round(fps))
Public Function TcToFr(ByVal s As String, ByVal fb As Long) As Long
    Dim a As Variant
    a = SplitParts(s, ":")
    TcToFr = CLng(a(0)) * 3600 * fb + CLng(a(1)) * 60 * fb + CLng(a(2)) * fb + CLng(a(3))
End Function

Public Function FrToTc(ByVal fr As Long, ByVal fb As Long) As String
    Dim f As Long, ff As Long, ss As Long, mm As Long, hh As Long
    If fr < 0 Then fr = 0
    f = fr
    ff = f Mod fb: f = f \ fb
    ss = f Mod 60: f = f \ 60
    mm = f Mod 60: hh = f \ 60
    FrToTc = Pad2(hh) & ":" & Pad2(mm) & ":" & Pad2(ss) & ":" & Pad2(ff)
End Function

Public Function TcFramesField(ByVal s As String) As Long
    TcFramesField = CLng(Right$(Trim$(s), 2))
End Function

' "мм:сс" или "чч:мм:сс" -> секунды; -1 если не распознано
Public Function ParseClock(ByVal s As String) As Long
    Dim a As Variant
    s = NormSp(s)
    If Len(s) = 0 Then Exit Function
    a = SplitParts(s, ":")
    On Error GoTo bad
    Select Case UBound(a)
        Case 1: ParseClock = CLng(a(0)) * 60 + CLng(a(1))
        Case 2: ParseClock = CLng(a(0)) * 3600 + CLng(a(1)) * 60 + CLng(a(2))
        Case Else: Exit Function
    End Select
    Exit Function
bad:
    ParseClock = -1
End Function

' ================= slug (как в студии) =================

Public Function Slugify(ByVal s As String) As String
    Dim i As Long, c As String, r As String
    If Len(Trim$(s)) = 0 Then s = "syuzhet"
    For i = 1 To Len(s)
        c = Mid$(s, i, 1)
        If (c >= "A" And c <= "Z") Or (c >= "a" And c <= "z") Or _
           (c >= "0" And c <= "9") Or c = "_" Or c = "-" Or c = " " Or _
           (c >= ChrW(1072) And c <= ChrW(1103)) Or _
           (c >= ChrW(1040) And c <= ChrW(1071)) Or _
           c = ChrW(1105) Or c = ChrW(1025) Then
            r = r & c
        End If
    Next i
    r = Trim$(r)
    r = Replace(r, " ", "_")
    If Len(r) > 60 Then r = Left$(r, 60)
    Slugify = r
End Function

' ================= UTF-8 файлы (без BOM-проблем, кроссплатформенно) =================

Public Function Utf8Bytes(ByVal s As String) As Byte()
    Dim b() As Byte, n As Long, i As Long, c As Long, c2 As Long
    ReDim b(0 To 3 + Len(s) * 3)
    b(0) = 239: b(1) = 187: b(2) = 191
    n = 3
    For i = 1 To Len(s)
        c = AscW(Mid$(s, i, 1))
        If c < 0 Then c = c + 65536
        If c >= 55296 And c <= 56319 Then
            If i < Len(s) Then
                c2 = AscW(Mid$(s, i + 1, 1))
                If c2 < 0 Then c2 = c2 + 65536
                If c2 >= 56320 And c2 <= 57343 Then
                    c = 65536 + (c - 55296) * 1024 + (c2 - 56320)
                    i = i + 1
                End If
            End If
        End If
        If n + 4 > UBound(b) Then ReDim Preserve b(0 To n + 8)
        If c < 128 Then
            b(n) = CByte(c): n = n + 1
        ElseIf c < 2048 Then
            b(n) = CByte(192 + (c \ 64))
            b(n + 1) = CByte(128 + (c Mod 64))
            n = n + 2
        ElseIf c < 65536 Then
            b(n) = CByte(224 + (c \ 4096))
            b(n + 1) = CByte(128 + ((c \ 64) Mod 64))
            b(n + 2) = CByte(128 + (c Mod 64))
            n = n + 3
        Else
            b(n) = CByte(240 + ((c \ 262144) Mod 64))
            b(n + 1) = CByte(128 + ((c \ 4096) Mod 64))
            b(n + 2) = CByte(128 + ((c \ 64) Mod 64))
            b(n + 3) = CByte(128 + (c Mod 64))
            n = n + 4
        End If
    Next i
    ReDim Preserve b(0 To n - 1)
    Utf8Bytes = b
End Function

Private Function CByte(ByVal v As Long) As Byte
    CByte = v And 255
End Function

Public Sub WriteUtf8Bom(ByVal path As String, ByVal text As String)
    Dim b() As Byte, f As Integer
    b = Utf8Bytes(text)
    f = FreeFile
    Open path For Binary As #f
    Put #f, , b
    Close #f
End Sub

Public Function ReadUtf8(ByVal path As String) As String
    Dim b() As Byte, f As Integer, n As Long, i As Long
    Dim c As Long, r As String
    n = FileLen(path)
    ReDim b(0 To n - 1)
    f = FreeFile
    Open path For Binary As #f
    Get #f, , b
    Close #f
    i = 0
    If n >= 3 Then
        If b(0) = 239 And b(1) = 187 And b(2) = 191 Then i = 3
    End If
    Do While i <= n - 1
        If b(i) < 128 Then
            c = b(i): i = i + 1
        ElseIf b(i) < 224 Then
            c = (b(i) - 192) * 64 + (b(i + 1) - 128): i = i + 2
        ElseIf b(i) < 240 Then
            c = (b(i) - 224) * 4096 + (b(i + 1) - 128) * 64 + (b(i + 2) - 128): i = i + 3
        Else
            c = (b(i) - 240) * 262144 + (b(i + 1) - 128) * 4096 + (b(i + 2) - 128) * 64 + (b(i + 3) - 128)
            i = i + 4
        End If
        If c > 65535 Then
            c = c - 65536
            r = r & ChrW(55296 + (c \ 1024)) & ChrW(56320 + (c Mod 1024))
        ElseIf c > 32767 Then
            r = r & ChrW(c - 65536)
        Else
            r = r & ChrW(c)
        End If
    Loop
    ReadUtf8 = r
End Function

Public Function HfsToPosix(ByVal p As String) As String
    Dim a As Variant, r As String, k As Long
    a = SplitParts(p, ":")
    For k = 1 To UBound(a)
        If Len(a(k)) > 0 Then r = r & "/" & a(k)
    Next k
    HfsToPosix = r
End Function

Public Function FileOk(ByVal path As String) As Boolean
    On Error GoTo nope
    FileOk = (FileLen(path) >= 0)
    Exit Function
nope:
    FileOk = False
End Function

' ================= пути =================

Public Function IsMac() As Boolean
    IsMac = (InStr(1, LCase$(Application.OperatingSystem), "mac") > 0)
End Function

' склеить папку и имя
Public Function PathJoin(ByVal base As String, ByVal name As String) As String
    If Len(Trim$(base)) = 0 Then PathJoin = name: Exit Function
    Dim last As String
    last = Right$(base, Len(base))
    If last = ":" Or last = "/" Then
        PathJoin = base & name
    ElseIf IsMac() Then
        PathJoin = base & "/" & name
    Else
        PathJoin = base & "\" & name
    End If
End Function

' базовое имя файла без пути (в любом разделителе)
Public Function BaseName(ByVal p As String) As String
    Dim i As Long
    i = InStrRev(p, "/")
    If InStrRev(p, "\") > i Then i = InStrRev(p, "\")
    If InStrRev(p, ":") > i Then i = InStrRev(p, ":")
    BaseName = Mid$(p, i + 1)
End Function

 ' папка документа в виде пути, пригодного для Open (POSIX на Mac)
Public Function DocFolder(doc As Document) As String
    Dim p As String
    p = doc.Path
    If IsMac() And InStr(p, ":") > 0 And InStr(p, "/") = 0 Then
        p = HfsToPosix(p)
    End If
    DocFolder = p
End Function

' нормализация пути для сравнения (префикс «относительно папки исходников»)
Public Function PathNorm(ByVal p As String) As String
    p = Replace(p, "\", "/")
    p = Replace(p, ":", "/")
    Do While InStr(p, "//") > 0
        p = Replace(p, "//", "/")
    Loop
    PathNorm = p
End Function

' если file лежит под root — вернуть относительный путь; иначе имя файла
Public Function RelToRoot(ByVal fileFullPath As String, ByVal root As String) As String
    Dim f As String, r As String
    If Len(Trim$(root)) = 0 Then RelToRoot = BaseName(fileFullPath): Exit Function
    f = PathNorm(fileFullPath)
    r = PathNorm(root)
    If Right$(r, 1) <> "/" Then r = r & "/"
    If StartsWith(f, r) Then
        RelToRoot = Mid$(f, Len(r) + 1)
    Else
        RelToRoot = BaseName(fileFullPath)
    End If
End Function
