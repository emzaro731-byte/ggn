import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:speech_to_text/speech_to_text.dart' as stt;
void main() => runApp(const MavisApp());

const bg = Color(0xFF050914);
const blue = Color(0xFF48A9FF);
const panel = Color(0xFF101C30);

class MavisApp extends StatelessWidget {
  const MavisApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Mavis AI',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          brightness: Brightness.dark,
          scaffoldBackgroundColor: bg,
          colorScheme: ColorScheme.fromSeed(seedColor: blue, brightness: Brightness.dark),
          useMaterial3: true,
          fontFamily: 'Roboto',
        ),
        home: const MavisHome(),
      );
}

class ChatLine {
  ChatLine(this.text, this.fromMavis);
  final String text;
  final bool fromMavis;
}

class MavisHome extends StatefulWidget {
  const MavisHome({super.key});
  @override
  State<MavisHome> createState() => _MavisHomeState();
}

class _MavisHomeState extends State<MavisHome> {
  final input = TextEditingController();
  final scroll = ScrollController();
  final speech = stt.SpeechToText();
  final messages = <ChatLine>[
    ChatLine('Hello. I’m Mavis, your personal AI assistant. What can I help you with?', true),
  ];
  bool chatOpen = false;
  bool listening = false;
  bool scanning = false;
  bool speechAvailable = false;
  String status = 'YOUR ASSISTANT IS READY';

  @override
  void initState() {
    super.initState();
    _initSpeech();
  }

  Future<void> _initSpeech() async {
    try {
      final available = await speech.initialize(
        onStatus: (s) { if (mounted) setState(() => listening = s == 'listening'); },
        onError: (_) { if (mounted) setState(() => listening = false); },
      );
      if (mounted) setState(() => speechAvailable = available);
    } catch (_) {}
  }

  @override
  void dispose() {
    input.dispose();
    scroll.dispose();
    speech.stop();
    super.dispose();
  }

  static const String _apiUrl = String.fromEnvironment(
    'MAVIS_API_URL',
    defaultValue: 'https://mavis-grok-api.onrender.com/api/chat',
  );

  Future<void> _send([String? value]) async {
    final text = (value ?? input.text).trim();
    if (text.isEmpty) return;
    setState(() {
      messages.add(ChatLine(text, false));
      input.clear();
      chatOpen = true;
      status = 'ASKING GROQ…';
    });
    try {
      final response = await http.post(
        Uri.parse(_apiUrl),
        headers: const {'Content-Type': 'application/json'},
        body: jsonEncode({'message': text}),
      ).timeout(const Duration(seconds: 90));
      final data = jsonDecode(response.body);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final error = data is Map ? (data['error'] ?? 'Server error') : 'Server error';
        throw Exception(error.toString());
      }
      final answer = data is Map ? (data['answer'] ?? data['response'] ?? '') : '';
      if (answer.toString().trim().isEmpty) throw Exception('The AI returned an empty response.');
      if (mounted) setState(() {
        messages.add(ChatLine(answer.toString(), true));
        status = 'GROQ AI CONNECTED';
      });
    } catch (e) {
      if (mounted) setState(() {
        messages.add(ChatLine(
          'I could not reach the Groq service. Check your internet connection and make sure the Render service is deployed with GROQ_API_KEY configured. Details: ${e.toString().replaceFirst('Exception: ', '')}',
          true,
        ));
        status = 'GROQ SERVICE UNAVAILABLE';
      });
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (scroll.hasClients) scroll.animateTo(scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    });
  }

  Future<void> _voice() async {
    if (listening) {
      await speech.stop();
      if (mounted) setState(() => listening = false);
      return;
    }
    if (!speechAvailable) {
      setState(() => messages.add(ChatLine('Voice input is unavailable. Check microphone permission and speech services on this phone.', true)));
      setState(() => chatOpen = true);
      return;
    }
    await speech.listen(onResult: (result) {
      if (mounted) setState(() => input.text = result.recognizedWords);
      if (result.finalResult && mounted) setState(() => listening = false);
    });
    if (mounted) setState(() => listening = true);
  }

  void _screenCommand() {
    setState(() {
      scanning = !scanning;
      chatOpen = true;
      status = scanning ? 'SCREEN READING REQUESTED' : 'SCREEN READING STOPPED';
      messages.add(ChatLine(
        scanning
          ? 'Screen reading requested. This build does not yet include the native Android screen-reading service, so it cannot inspect other apps. You can stop this request here.'
          : 'Screen-reading request stopped.',
        true,
      ));
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(children: [
        const Positioned.fill(child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: RadialGradient(center: Alignment(0.72, -0.65), radius: 1.15,
              colors: [Color(0xFF102D55), bg, bg]),
          ),
        )),
        SafeArea(child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(22, 14, 22, 10),
            child: Row(children: [
              Container(width: 44, height: 44,
                decoration: BoxDecoration(shape: BoxShape.circle,
                  gradient: const LinearGradient(colors: [Color(0xFF72D5FF), Color(0xFF1764D8)]),
                  boxShadow: [BoxShadow(color: blue.withOpacity(.35), blurRadius: 20)]),
                child: const Icon(Icons.all_inclusive_rounded, color: Colors.white, size: 28)),
              const SizedBox(width: 12),
              const Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('MAVIS', style: TextStyle(letterSpacing: 4, fontWeight: FontWeight.w800, fontSize: 20)),
                Text('PERSONAL AI', style: TextStyle(color: blue, fontSize: 10, letterSpacing: 2.6)),
              ])),
              IconButton(onPressed: () => setState(() => chatOpen = !chatOpen),
                icon: Icon(chatOpen ? Icons.dashboard_rounded : Icons.chat_bubble_outline_rounded)),
            ]),
          ),
          Expanded(child: chatOpen ? _chatPanel() : _homePanel()),
          if (!chatOpen) Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
            child: Row(children: [
              Expanded(child: _quickAction(Icons.chat_rounded, 'Ask Mavis', () => setState(() => chatOpen = true))),
              const SizedBox(width: 10),
              Expanded(child: _quickAction(Icons.graphic_eq_rounded, 'Voice', _voice)),
              const SizedBox(width: 10),
              Expanded(child: _quickAction(Icons.document_scanner_outlined, 'Read screen', _screenCommand)),
            ]),
          ),
        ])),
        // Floating assistant hub is visible immediately on app open.
        Positioned(right: 18, bottom: chatOpen ? 100 : 105,
          child: GestureDetector(
            onTap: () => setState(() => chatOpen = !chatOpen),
            child: Container(width: 58, height: 58,
              decoration: BoxDecoration(shape: BoxShape.circle,
                gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight,
                  colors: [Color(0xFF82E2FF), Color(0xFF1768E8), Color(0xFF102D68)]),
                border: Border.all(color: Colors.white.withOpacity(.55), width: 1.2),
                boxShadow: [BoxShadow(color: blue.withOpacity(.42), blurRadius: 24, spreadRadius: 2)]),
              child: const Center(child: Text('M', style: TextStyle(fontSize: 27, fontWeight: FontWeight.w900, color: Colors.white))),
            ),
          ),
        ),
      ]),
    );
  }

  Widget _homePanel() => Center(child: SingleChildScrollView(
    padding: const EdgeInsets.symmetric(horizontal: 25),
    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      Container(width: 154, height: 154,
        decoration: BoxDecoration(shape: BoxShape.circle,
          color: Colors.white.withOpacity(.035),
          border: Border.all(color: blue.withOpacity(.35), width: 1.3),
          boxShadow: [BoxShadow(color: blue.withOpacity(.13), blurRadius: 55, spreadRadius: 8)]),
        child: Center(child: Container(width: 112, height: 112,
          decoration: BoxDecoration(shape: BoxShape.circle,
            gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight,
              colors: [Color(0xFF73DFFF), Color(0xFF1267E8), Color(0xFF081A3D)]),
            boxShadow: [BoxShadow(color: blue.withOpacity(.3), blurRadius: 25)]),
          child: const Icon(Icons.all_inclusive_rounded, size: 65, color: Colors.white)))),
      const SizedBox(height: 28),
      const Text('Your world,', style: TextStyle(fontSize: 29, fontWeight: FontWeight.w300)),
      const Text('connected to intelligence.', textAlign: TextAlign.center,
        style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: Color(0xFF83CFFF))),
      const SizedBox(height: 12),
      Text(status, style: const TextStyle(fontSize: 10, letterSpacing: 2.1, color: Colors.white54)),
      const SizedBox(height: 26),
      Wrap(spacing: 8, runSpacing: 8, alignment: WrapAlignment.center, children: [
        _chip('Ask anything', Icons.auto_awesome),
        _chip('Voice control', Icons.mic_none),
        _chip('Trading insights', Icons.show_chart),
      ]),
    ]),
  ));

  Widget _chatPanel() => Container(
    margin: const EdgeInsets.fromLTRB(14, 8, 14, 12),
    decoration: BoxDecoration(color: panel.withOpacity(.78),
      borderRadius: BorderRadius.circular(26),
      border: Border.all(color: blue.withOpacity(.22))),
    child: Column(children: [
      Padding(padding: const EdgeInsets.fromLTRB(18, 16, 18, 10),
        child: Row(children: [
          const Expanded(child: Text('Mavis Assistant', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700))),
          IconButton(
            tooltip: 'Ask for a buy/sell signal',
            onPressed: () => _send('Analyze the market for a possible BUY, SELL, or WAIT signal. Ask me for the symbol, timeframe, current price, and chart data if missing. Do not invent live prices. Include entry, stop-loss, take-profit, and confidence only when supported by the supplied data.'),
            icon: const Icon(Icons.show_chart_rounded, color: blue),
          ),
          TextButton.icon(onPressed: _screenCommand,
            icon: Icon(scanning ? Icons.stop_circle_outlined : Icons.document_scanner_outlined, size: 17),
            label: Text(scanning ? 'Stop' : 'Read screen')),
        ])),
      const Divider(height: 1, color: Color(0x223F9CFF)),
      Expanded(child: ListView.builder(controller: scroll, padding: const EdgeInsets.all(14),
        itemCount: messages.length,
        itemBuilder: (context, i) {
          final m = messages[i];
          return Align(alignment: m.fromMavis ? Alignment.centerLeft : Alignment.centerRight,
            child: Container(
              constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * .78),
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.all(13),
              decoration: BoxDecoration(
                color: m.fromMavis ? const Color(0xFF162A43) : const Color(0xFF145CB7),
                borderRadius: BorderRadius.circular(17),
                border: Border.all(color: m.fromMavis ? Colors.white10 : blue.withOpacity(.35))),
              child: Text(m.text, style: const TextStyle(height: 1.4, fontSize: 13)),
            ));
        })),
      Padding(padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
        child: Row(children: [
          IconButton(onPressed: _voice, icon: Icon(listening ? Icons.mic : Icons.mic_none, color: listening ? blue : Colors.white70)),
          Expanded(child: TextField(controller: input, minLines: 1, maxLines: 4,
            onSubmitted: (_) => _send(),
            decoration: InputDecoration(hintText: listening ? 'Listening…' : 'Message Mavis',
              filled: true, fillColor: Colors.black26, contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(20), borderSide: BorderSide.none)))),
          const SizedBox(width: 6),
          IconButton(onPressed: _send, style: IconButton.styleFrom(backgroundColor: blue),
            icon: const Icon(Icons.arrow_upward_rounded, color: Colors.white)),
        ])),
    ]),
  );

  Widget _quickAction(IconData icon, String label, VoidCallback action) => InkWell(
    onTap: action,
    borderRadius: BorderRadius.circular(17),
    child: Container(padding: const EdgeInsets.symmetric(vertical: 15, horizontal: 6),
      decoration: BoxDecoration(color: Colors.white.withOpacity(.045),
        borderRadius: BorderRadius.circular(17), border: Border.all(color: blue.withOpacity(.2))),
      child: Column(children: [
        Icon(icon, color: const Color(0xFF86CFFF), size: 22),
        const SizedBox(height: 8),
        Text(label, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
      ]),
    ),
  );

  Widget _chip(String text, IconData icon) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
    decoration: BoxDecoration(color: Colors.white.withOpacity(.045),
      borderRadius: BorderRadius.circular(30), border: Border.all(color: blue.withOpacity(.18))),
    child: Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(icon, size: 14, color: blue), const SizedBox(width: 6),
      Text(text, style: const TextStyle(fontSize: 11, color: Colors.white70)),
    ]),
  );
}
